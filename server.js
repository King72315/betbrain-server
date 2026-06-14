const { spawn } = require("child_process");
const path = require("path");

const serverEntry = path.join(__dirname, "betbrain-server", "server.js");

const child = spawn(process.execPath, [serverEntry], {
  stdio: "inherit",
  env: process.env,
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 0);
});
