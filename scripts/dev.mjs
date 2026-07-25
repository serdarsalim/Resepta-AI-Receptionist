#!/usr/bin/env node
// One command for the whole dev loop: Convex backend + Next frontend.
// Output is prefixed per process; Ctrl-C (or either process dying) takes both
// down, so you never leave a stray `next dev` holding port 3006.

import { spawn } from "node:child_process";

const PROCS = [
  { name: "convex", color: "\x1b[35m", cmd: "npx", args: ["convex", "dev"] },
  { name: "next", color: "\x1b[36m", cmd: "npm", args: ["run", "dev:frontend"] },
];

const RESET = "\x1b[0m";
const children = [];
let shuttingDown = false;

function prefix(proc, chunk) {
  const label = `${proc.color}[${proc.name}]${RESET} `;
  return String(chunk)
    .split("\n")
    .filter((line, i, all) => line !== "" || i < all.length - 1)
    .map((line) => label + line)
    .join("\n");
}

function shutdown(code) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
  }
  // Give them a beat to exit cleanly, then leave.
  setTimeout(() => process.exit(code), 300);
}

for (const proc of PROCS) {
  const child = spawn(proc.cmd, proc.args, {
    stdio: ["inherit", "pipe", "pipe"],
    env: process.env,
  });
  children.push(child);

  child.stdout.on("data", (chunk) => console.log(prefix(proc, chunk)));
  child.stderr.on("data", (chunk) => console.error(prefix(proc, chunk)));

  child.on("exit", (code, signal) => {
    if (shuttingDown) return;
    console.log(
      prefix(proc, `exited (${signal ?? code}) — stopping the other process`),
    );
    shutdown(code ?? 1);
  });
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => shutdown(0));
}
