/** @type {import('jest').Config} */
module.exports = {
  displayName: 'simulator',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  collectCoverageFrom: ['src/**/*.ts', '!src/index.ts'],
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.test.json' }],
  },
  moduleNameMapper: {
    '^@panini/(.*)$': '<rootDir>/../$1/src',
  },
};
