// Minimal flat config. Purpose: catch undefined references (no-undef) — the safety net for the
// App.jsx component extraction. Noise rules (unused vars etc.) are relaxed on purpose.
import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'

export default [
  { ignores: ['dist/**', 'node_modules/**'] },
  js.configs.recommended,
  {
    files: ['src/**/*.{js,jsx}'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: { ...globals.browser, ...globals.node },
    },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'no-undef': 'error',            // THE safety net for the refactor
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^[A-Z_]' }],
      'react-hooks/rules-of-hooks': 'error',
      'no-empty': 'off',
      'no-cond-assign': 'off',
      'no-useless-escape': 'off',
    },
  },
]
