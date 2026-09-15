const js = require('@eslint/js');
const globals = require('globals');

module.exports = [
  js.configs.recommended,

  // eslint.config.js sendiri jalan di Node.js
  {
    files: ['eslint.config.js'],
    languageOptions: {
      sourceType: 'commonjs',
      globals: globals.node,
    },
  },

  // Backend: Node.js (CommonJS)
  {
    files: ['src/**/*.js', 'scripts/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: globals.node,
    },
    rules: {
      // Pola idiomatik di db/client.js: ALTER TABLE dibungkus try/catch kosong
      // supaya migrasi kolom idempoten (aman dijalankan berkali-kali kalau
      // kolomnya sudah ada). Ini kesengajaan, bukan kelalaian.
      'no-empty': ['error', { allowEmptyCatch: true }],
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_?e$' }],
    },
  },

  // Test files: Node.js + global Jest
  {
    files: ['tests/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: { ...globals.node, ...globals.jest },
    },
    rules: {
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_?e$' }],
    },
  },

  // Frontend: browser (tanpa module bundler -- tiap file punya scope
  // global sendiri-sendiri, dihubungkan lewat urutan <script> tag di HTML)
  {
    files: ['public/assets/js/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: {
        ...globals.browser,
        // Didefinisikan di api.js, dipakai file lain lewat urutan <script> tag.
        getToken: 'readonly',
        getUser: 'readonly',
        logout: 'readonly',
        apiRequest: 'readonly',
      },
    },
    rules: {
      // Banyak fungsi di sini dipanggil lewat onclick="..." inline di HTML,
      // bukan direferensikan langsung di JS lain -- ESLint tidak bisa lihat
      // itu (statis, cuma baca .js), jadi "unused" di sini seringnya false
      // positive. Tetap warning (bukan error) supaya tidak bikin lint gagal.
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      // getToken/getUser/logout/apiRequest didaftarkan sebagai global (dipakai
      // file lain lewat urutan <script> tag), tapi api.js sendiri yang
      // MENDEFINISIKANNYA -- itu bukan redeclare yang perlu diributkan.
      'no-redeclare': 'off',
    },
  },

  {
    ignores: ['node_modules/**', 'coverage/**', 'data.db*'],
  },
];
