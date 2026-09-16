module.exports = {
  extends: ["@commitlint/config-conventional"],
  rules: {
    "scope-enum": [
      2,
      "always",
      [
        "seats",
        "logging",
        "auth",
        "config",
        "cache",
        "db",
        "infra",
        "ci",
        "obs",
        "api",
        "health",
      ],
    ],
  },
};
