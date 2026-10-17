/** @type {import('jest').Config} */
module.exports = {
  projects: [
    '<rootDir>/packages/core',
    '<rootDir>/packages/rules-engine',
    '<rootDir>/packages/standards-schema',
    '<rootDir>/packages/extract',
    '<rootDir>/packages/insights',
    '<rootDir>/packages/fiu-client',
    '<rootDir>/packages/simulator',
  ],
  coverageProvider: 'v8',
};
