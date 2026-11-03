import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import vue from 'eslint-plugin-vue';

/** 只做“明显错误”的检查，风格问题交给 prettier/编辑器 */
export default [
  {
    ignores: ['**/dist/**', '**/node_modules/**', 'packages/server/public/**', 'vendor/**', '**/*.d.ts']
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...vue.configs['flat/recommended'],
  {
    files: ['**/*.vue'],
    languageOptions: {
      parserOptions: { parser: tseslint.parser, ecmaVersion: 'latest', sourceType: 'module' }
    }
  },
  {
    languageOptions: {
      globals: { process: 'readonly', Buffer: 'readonly', console: 'readonly', setTimeout: 'readonly' }
    },
    rules: {
      // TS 自己会报未定义变量；eslint 的 no-undef 在 TS/Vue 项目里噪音太大
      'no-undef': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/no-require-imports': 'off',
      'vue/multi-word-component-names': 'off',
      'vue/max-attributes-per-line': 'off',
      'vue/singleline-html-element-content-newline': 'off',
      'vue/html-self-closing': 'off',
      'no-empty': ['error', { allowEmptyCatch: true }]
    }
  }
];
