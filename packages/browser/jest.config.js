/** @type {import('jest').Config} */
module.exports = {
  displayName: 'browser',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  collectCoverageFrom: ['src/**/*.ts', '!src/index.ts', '!src/data.gen.ts'],
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.test.json' }],
  },
  moduleNameMapper: {
    '^@paniniapi/(.*)$': '<rootDir>/../$1/src',
  },
};
