import { closeDb } from "./client";
import { seedDefaults } from "./seed";

seedDefaults()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => closeDb());
