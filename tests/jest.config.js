module.exports = {
  testEnvironment: "jsdom",
  testMatch: ["<rootDir>/**/*.test.js"],
  // the views are plain browser scripts and modules; Babel turns their import and export into what Jest runs
  transform: { "\\.js$": "babel-jest" },
  testPathIgnorePatterns: ["/node_modules/"],
};
