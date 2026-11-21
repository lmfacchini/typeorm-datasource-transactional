module.exports = {
  rootDir: ".",
  testMatch: ["<rootDir>/src/**/*.spec.ts"],

  moduleFileExtensions: ["ts", "js", "json"],

  transform: {
    "^.+\\.tsx?$": [
      "ts-jest",
      {
        tsconfig: "tsconfig.spec.json",
      },
    ],
  },

  testEnvironment: "node",

  collectCoverageFrom: ["src/**/*.{ts,js}", "!src/**/*.spec.ts"],

  coverageDirectory: "coverage",
};
