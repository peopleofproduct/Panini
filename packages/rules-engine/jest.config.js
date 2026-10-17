/** @type {import('jest').Config} */
module.exports = {
  displayName: 'rules-engine',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  collectCoverageFrom: ['src/**/*.ts', '!src/index.ts'],
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.test.json' }],
  },
  moduleNameMapper: {
    '^@paniniapi/(.*)$': '<rootDir>/../$1/src',
  },
};
