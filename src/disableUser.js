import { setUserEnabled } from "./storage.js";

const userId = process.argv[2];
const enabled = process.argv[3] === "enable";

if (!userId) {
  console.error("Usage: npm run disable-user -- <userId>");
  process.exit(1);
}

setUserEnabled(userId, enabled)
  .then((user) => {
    console.log(`${user.id} ${user.enabled ? "enabled" : "disabled"}`);
  })
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
