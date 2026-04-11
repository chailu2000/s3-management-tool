module.exports = {
    preset: 'ts-jest',
    testEnvironment: 'node',
    roots: ['<rootDir>/src'],
    testMatch: ['<rootDir>/src/tests/unit/**/*.test.ts'],
    collectCoverageFrom: [
        'src/**/*.ts',
        '!src/**/*.test.ts',
        '!src/tests/**'
    ],
    moduleFileExtensions: ['ts', 'js', 'json'],
    transform: {
        '^.+\\.ts$': ['ts-jest', {
            tsconfig: {
                types: ['node', 'jest'],
                module: 'commonjs',
                target: 'ES2020',
                lib: ['es2020'],
                sourceMap: true,
                strict: true,
                esModuleInterop: true
            }
        }]
    }
};
