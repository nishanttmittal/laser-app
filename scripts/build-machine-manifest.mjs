#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { deflateSync } from 'node:zlib'

const PROGRAM_EXTENSIONS = new Set(['.zx', '.zzx', '.dxf', '.nc', '.tube'])
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.bmp'])
const DEFAULT_PREVIEW_LIMIT = 350 * 1024
const TOTAL_EMBED_LIMIT = 16 * 1024 * 1024
const SKIP_FOLDERS = new Set([
  '$recycle.bin',
  'system volume information',
  '.git',
  'node_modules',
  'temp',
  'tmp',
])

function usage() {
  console.error('Usage: node scripts/build-machine-manifest.mjs <read-only-source-folder> <output.json> [--previous=old-manifest.json] [--preview-limit-kb=350] [--verify-hashes]')
}

function sourceApp(filePath) {
  if (/tubepro/i.test(filePath)) return 'TubePro'
  if (/tubest/i.test(filePath)) return 'TubeST'
  return 'Unknown'
}

function stem(filePath) {
  return path.basename(filePath, path.extname(filePath)).trim().toLowerCase()
}

function dirStem(filePath) {
  return `${path.dirname(filePath).toLowerCase()}\0${stem(filePath)}`
}

async function hashFile(filePath) {
  const bytes = await fs.readFile(filePath)
  return createHash('sha256').update(bytes).digest('hex')
}

function hashBytes(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

function archiveCommands(filePath, entry = '') {
  const unzip = entry
    ? { command: 'unzip', args: ['-p', filePath, entry] }
    : { command: 'unzip', args: ['-Z1', filePath] }
  const tar = entry
    ? { command: 'tar', args: ['-xOf', filePath, entry] }
    : { command: 'tar', args: ['-tf', filePath] }
  // Windows ships bsdtar but usually not unzip. Linux extraction keeps unzip first because its
  // ZIP handling and entry names match the original scanner behavior.
  return process.platform === 'win32' ? [tar, unzip] : [unzip, tar]
}

function readArchive(filePath, entry = '', encoding = null, maxBuffer = 32 * 1024 * 1024) {
  for (const candidate of archiveCommands(filePath, entry)) {
    const result = spawnSync(candidate.command, candidate.args, {
      encoding,
      maxBuffer,
      timeout: 5000,
      windowsHide: true,
    })
    if (result.status === 0 && result.stdout?.length) return result.stdout
  }
  return null
}

function unzipEntry(filePath, entry) {
  return readArchive(filePath, entry)
}

function unzipEntries(filePath) {
  const output = readArchive(filePath, '', 'utf8', 4 * 1024 * 1024)
  return output ? output.split(/\r?\n/).filter(Boolean) : []
}

function xmlAttribute(xml, tag, attribute) {
  if (!xml) return ''
  const tagMatch = xml.match(new RegExp(`<${tag}\\b[^>]*>`, 'i'))
  if (!tagMatch) return ''
  const attributeMatch = tagMatch[0].match(new RegExp(`\\b${attribute}="([^"]*)"`, 'i'))
  return attributeMatch ? attributeMatch[1] : ''
}

function crc32(bytes) {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0)
  }
  return (crc ^ 0xffffffff) >>> 0
}

function pngChunk(type, data) {
  const typeBytes = Buffer.from(type, 'ascii')
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const checksum = Buffer.alloc(4)
  checksum.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])))
  return Buffer.concat([length, typeBytes, data, checksum])
}

function bmpToPng(bytes) {
  if (!bytes || bytes.length < 54 || bytes.toString('ascii', 0, 2) !== 'BM') return null
  const pixelOffset = bytes.readUInt32LE(10)
  const width = bytes.readInt32LE(18)
  const signedHeight = bytes.readInt32LE(22)
  const height = Math.abs(signedHeight)
  const bits = bytes.readUInt16LE(28)
  const compression = bytes.readUInt32LE(30)
  if (width <= 0 || height <= 0 || width > 4096 || height > 4096 || ![24, 32].includes(bits) || compression !== 0) return null

  const sourceStride = Math.floor((bits * width + 31) / 32) * 4
  if (pixelOffset + sourceStride * height > bytes.length) return null
  const raw = Buffer.alloc((width * 4 + 1) * height)
  for (let y = 0; y < height; y++) {
    const sourceY = signedHeight > 0 ? height - 1 - y : y
    const sourceRow = pixelOffset + sourceY * sourceStride
    const targetRow = y * (width * 4 + 1)
    raw[targetRow] = 0
    for (let x = 0; x < width; x++) {
      const sourcePixel = sourceRow + x * (bits / 8)
      const targetPixel = targetRow + 1 + x * 4
      raw[targetPixel] = bytes[sourcePixel + 2]
      raw[targetPixel + 1] = bytes[sourcePixel + 1]
      raw[targetPixel + 2] = bytes[sourcePixel]
      raw[targetPixel + 3] = bits === 32 ? bytes[sourcePixel + 3] : 255
    }
  }

  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header[8] = 8
  header[9] = 6
  return Buffer.concat([
    Buffer.from('89504e470d0a1a0a', 'hex'),
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ])
}

function imageDataUrl(bytes, limit) {
  if (!bytes?.length || limit <= 0) return ''
  const png = bmpToPng(bytes)
  if (png && png.length <= limit) return `data:image/png;base64,${png.toString('base64')}`
  if (bytes.length <= limit) return `data:image/bmp;base64,${bytes.toString('base64')}`
  return ''
}

function embeddedDataSize(dataUrl) {
  if (!dataUrl) return 0
  const comma = dataUrl.indexOf(',')
  return comma >= 0 ? Math.floor((dataUrl.length - comma - 1) * 3 / 4) : 0
}

function inspectProgramPackage(filePath, previewLimit, embedBudget) {
  const infoBytes = unzipEntry(filePath, 'info.xml')
  const segmentsBytes = unzipEntry(filePath, 'Segments/content.xml')
  if (!infoBytes && !segmentsBytes) return null

  const info = infoBytes?.toString('utf8') || ''
  const segments = segmentsBytes?.toString('utf8') || ''
  const appName = xmlAttribute(info, 'Application', 'AppName')
  const appVersion = xmlAttribute(info, 'Application', 'AppVer')
  const savedAt = xmlAttribute(info, 'SavedBy', 'SaveTime')
  const section = xmlAttribute(segments, 'CrossSection', 'SectionClass')
  const thicknessRaw = xmlAttribute(segments, 'CrossSection', 'ThickNess')
  const quantity = (segments.match(/<TubeSegment\b/gi) || []).length
  const thumbnailEntries = unzipEntries(filePath)
    .filter((entry) => /^Thumbnail\/(?:Seg|\d+)$/i.test(entry))
    .sort((a, b) => Number(b.toLowerCase() === 'thumbnail/seg') - Number(a.toLowerCase() === 'thumbnail/seg'))
  let remainingPreviewBytes = embedBudget
  const previews = []
  for (const entry of thumbnailEntries) {
    const thumbnail = unzipEntry(filePath, entry)
    if (!thumbnail) continue
    const previewData = imageDataUrl(thumbnail, Math.min(previewLimit, remainingPreviewBytes))
    const embeddedSizeBytes = embeddedDataSize(previewData)
    remainingPreviewBytes = Math.max(0, remainingPreviewBytes - embeddedSizeBytes)
    previews.push({
      fileName: `${path.basename(filePath)}-${path.basename(entry)}.${previewData.startsWith('data:image/png') ? 'png' : 'bmp'}`,
      sourcePath: `${filePath}#${entry}`,
      sizeBytes: thumbnail.length,
      embeddedSizeBytes,
      sha256: hashBytes(thumbnail),
      dataUrl: previewData,
      matchEvidence: 'embedded-program-thumbnail',
    })
  }

  return {
    sourceApp: appName.toLowerCase() === 'tubest' ? 'TubeST' : appName,
    sourceVersion: appVersion || '',
    savedAt,
    details: {
      section,
      thickness: thicknessRaw !== '' && Number.isFinite(Number(thicknessRaw)) ? Number(thicknessRaw) : null,
      quantity: quantity || null,
    },
    preview: previews[0] || null,
    previews,
  }
}

async function walk(root) {
  const files = []
  const extensionCounts = {}
  const stack = [root]
  let unreadableFolders = 0

  while (stack.length) {
    const folder = stack.pop()
    let entries
    try { entries = await fs.readdir(folder, { withFileTypes: true }) }
    catch {
      unreadableFolders += 1
      continue
    }
    for (const entry of entries) {
      const filePath = path.join(folder, entry.name)
      if (entry.isDirectory()) {
        if (!SKIP_FOLDERS.has(entry.name.toLowerCase())) stack.push(filePath)
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase() || '[none]'
        extensionCounts[ext] = (extensionCounts[ext] || 0) + 1
        if (PROGRAM_EXTENSIONS.has(ext) || IMAGE_EXTENSIONS.has(ext)) files.push({ filePath, ext })
      }
    }
  }
  return { files, extensionCounts, unreadableFolders }
}

function selectPreview(program, images, programsInFolder) {
  const exact = images.filter((image) => dirStem(image.filePath) === dirStem(program.filePath))
  if (exact.length === 1) {
    return { image: exact[0], matchEvidence: 'same-directory-exact-stem' }
  }

  const folder = path.dirname(program.filePath).toLowerCase()
  const folderImages = images.filter((image) => path.dirname(image.filePath).toLowerCase() === folder)
  if (programsInFolder === 1 && folderImages.length === 1) {
    return { image: folderImages[0], matchEvidence: 'single-program-single-image-folder' }
  }
  return null
}

async function buildProgramRecord(program, images, folderProgramCount, previewLimit, embedBudget) {
  const stat = await fs.stat(program.filePath)
  const packageData = inspectProgramPackage(program.filePath, previewLimit, embedBudget)
  const previewHit = packageData?.previews?.length ? null : selectPreview(program, images, folderProgramCount)
  let preview = null
  let previews = []
  if (packageData?.preview) {
    preview = packageData.preview
    previews = packageData.previews
  } else if (previewHit) {
    const previewStat = await fs.stat(previewHit.image.filePath)
    const mime = previewHit.image.ext === '.jpg' || previewHit.image.ext === '.jpeg'
      ? 'image/jpeg'
      : previewHit.image.ext === '.png'
        ? 'image/png'
        : previewHit.image.ext === '.webp'
          ? 'image/webp'
          : ''
    let dataUrl = ''
    if (mime && previewStat.size <= Math.min(previewLimit, embedBudget)) {
      const bytes = await fs.readFile(previewHit.image.filePath)
      dataUrl = `data:${mime};base64,${bytes.toString('base64')}`
    }
    preview = {
      fileName: path.basename(previewHit.image.filePath),
      sourcePath: previewHit.image.filePath,
      sizeBytes: previewStat.size,
      embeddedSizeBytes: embeddedDataSize(dataUrl),
      sha256: await hashFile(previewHit.image.filePath),
      dataUrl,
      matchEvidence: previewHit.matchEvidence,
    }
    previews = [preview]
  }

  return {
    fileName: path.basename(program.filePath),
    sourceApp: packageData?.sourceApp || sourceApp(program.filePath),
    sourceVersion: packageData?.sourceVersion || '',
    sourcePath: program.filePath,
    sizeBytes: stat.size,
    modifiedAt: stat.mtime.toISOString(),
    sha256: await hashFile(program.filePath),
    savedAt: packageData?.savedAt || '',
    preview,
    previews,
    details: packageData?.details || {},
    evidence: packageData
      ? [
          'TubeST/TubePro package metadata read from embedded XML',
          previews.length
            ? `${previews.length} embedded program thumbnail${previews.length === 1 ? '' : 's'}`
            : 'No embedded thumbnail present',
        ]
      : previewHit
        ? [`Preview: ${previewHit.matchEvidence}`]
        : ['Program file inventoried; no uniquely supported preview match'],
  }
}

async function main() {
  const args = process.argv.slice(2)
  const sourceArg = args.find((arg) => !arg.startsWith('--'))
  const outputArg = args.filter((arg) => !arg.startsWith('--'))[1]
  if (!sourceArg || !outputArg) {
    usage()
    process.exitCode = 1
    return
  }
  const limitArg = args.find((arg) => arg.startsWith('--preview-limit-kb='))
  const previousArg = args.find((arg) => arg.startsWith('--previous='))
  const verifyHashes = args.includes('--verify-hashes')
  const previewLimitKb = limitArg ? Number(limitArg.split('=')[1]) : DEFAULT_PREVIEW_LIMIT / 1024
  if (!Number.isFinite(previewLimitKb) || previewLimitKb < 0) {
    throw new Error('Preview limit must be a positive number of KB.')
  }

  const root = path.resolve(sourceArg)
  const output = path.resolve(outputArg)
  const rootStat = await fs.stat(root)
  if (!rootStat.isDirectory()) throw new Error('The source path is not a folder.')
  let previousPrograms = new Map()
  if (previousArg) {
    const previousPath = path.resolve(previousArg.slice('--previous='.length))
    const previous = JSON.parse(await fs.readFile(previousPath, 'utf8'))
    previousPrograms = new Map((previous.programs || []).map((program) => [program.sourcePath, program]))
  }

  const { files, extensionCounts, unreadableFolders } = await walk(root)
  const programs = files.filter((file) => PROGRAM_EXTENSIONS.has(file.ext))
  const images = files.filter((file) => IMAGE_EXTENSIONS.has(file.ext))
  const countsByFolder = new Map()
  for (const program of programs) {
    const folder = path.dirname(program.filePath).toLowerCase()
    countsByFolder.set(folder, (countsByFolder.get(folder) || 0) + 1)
  }

  const records = []
  let embeddedBytes = 0
  let reusedPrograms = 0
  for (const program of programs) {
    const stat = await fs.stat(program.filePath)
    const modifiedAt = stat.mtime.toISOString()
    const previous = previousPrograms.get(program.filePath)
    const reusable = previous
      && previous.sizeBytes === stat.size
      && previous.modifiedAt === modifiedAt
      && (!verifyHashes || (previous.sha256 && previous.sha256 === await hashFile(program.filePath)))
    if (reusable) {
      records.push(previous)
      const previousPreviews = previous.previews?.length ? previous.previews : [previous.preview].filter(Boolean)
      for (const preview of previousPreviews) {
        if (preview.dataUrl) embeddedBytes += preview.embeddedSizeBytes || embeddedDataSize(preview.dataUrl)
      }
      reusedPrograms += 1
      continue
    }
    const record = await buildProgramRecord(
      program,
      images,
      countsByFolder.get(path.dirname(program.filePath).toLowerCase()) || 0,
      previewLimitKb * 1024,
      Math.max(0, TOTAL_EMBED_LIMIT - embeddedBytes),
    )
    for (const preview of record.previews || []) {
      if (preview.dataUrl) embeddedBytes += preview.embeddedSizeBytes || embeddedDataSize(preview.dataUrl)
    }
    records.push(record)
  }
  records.sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt) || a.fileName.localeCompare(b.fileName))

  const manifest = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    sourceRoot: root,
    machine: '',
    inventory: {
      filesSeen: Object.values(extensionCounts).reduce((sum, count) => sum + count, 0),
      programFiles: records.length,
      imageFiles: images.length,
      previewsMatched: records.filter((record) => record.preview).length,
      previewsFound: records.reduce((sum, record) => sum + (record.previews || []).length, 0),
      previewsEmbedded: records.reduce((sum, record) =>
        sum + (record.previews || []).filter((preview) => preview.dataUrl).length, 0),
      reusedPrograms,
      scannedPrograms: records.length - reusedPrograms,
      unreadableFolders,
      extensionCounts,
    },
    programs: records,
  }

  await fs.writeFile(output, `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'w' })
  console.log(JSON.stringify({
    output,
    programs: manifest.inventory.programFiles,
    matchedPreviews: manifest.inventory.previewsMatched,
    embeddedPreviews: manifest.inventory.previewsEmbedded,
    reusedPrograms,
    scannedPrograms: manifest.inventory.scannedPrograms,
    unreadableFolders,
  }, null, 2))
}

main().catch((error) => {
  console.error(error.message)
  process.exitCode = 1
})
