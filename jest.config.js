/** @type {import('jest').Config} */
module.exports = {
  projects: [
    '<rootDir>/packages/core',
    '<rootDir>/packages/rules-engine',
    '<rootDir>/packages/standards-schema',
  ],
  coverageProvider: 'v8',
};
