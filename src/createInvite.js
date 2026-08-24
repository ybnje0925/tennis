import { addInviteCode } from "./storage.js";

const code = process.argv[2]?.trim().toUpperCase();

addInviteCode({ code })
  .then((invite) => {
    console.log(invite.code);
  })
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
