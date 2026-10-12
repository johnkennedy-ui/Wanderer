import { createServer } from "node:net";

export const choosePlaywrightPort = async (environment = process.env) => {
  if (environment.PLAYWRIGHT_PORT !== undefined) {
    const configuredPort = Number(environment.PLAYWRIGHT_PORT);
    if (
      !Number.isInteger(configuredPort) ||
      configuredPort < 1 ||
      configuredPort > 65_535
    )
      throw new Error(
        `Invalid PLAYWRIGHT_PORT: ${environment.PLAYWRIGHT_PORT}`,
      );
    return configuredPort;
  }

  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (address === null || typeof address === "string")
    throw new Error("Could not determine an ephemeral Playwright port");
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
  return address.port;
};
