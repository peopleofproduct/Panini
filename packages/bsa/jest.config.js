/** @type {import('jest').Config} */
module.exports = {
  displayName: 'bsa',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  collectCoverageFrom: ['src/**/*.ts', '!src/index.ts', '!src/cli.ts'],
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.test.json' }],
  },
  moduleNameMapper: {
    '^@paniniapi/(.*)$': '<rootDir>/../$1/src',
  },
};
