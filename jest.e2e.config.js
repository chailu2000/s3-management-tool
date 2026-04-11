module.exports = {
    preset: 'ts-jest',
    testEnvironment: 'node',
    roots: ['<rootDir>/src/tests/e2e'],
    testMatch: ['**/*.e2e.test.ts'],
    transform: {
        '^.+\\.tsx?$': ['ts-jest', {
            tsconfig: {
                types: ['node', 'jest'],
            },
        }],
    },
    moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],
    testTimeout: 60000, // 60 seconds for E2E tests
    verbose: true,
    // Fix for AWS SDK v3 dynamic imports
    transformIgnorePatterns: [
        'node_modules/(?!( @aws-sdk|@smithy)/)',
    ],
    testEnvironmentOptions: {
        url: 'http://localhost',
    },
};
