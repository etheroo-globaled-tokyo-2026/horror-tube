import type { Server } from "node:http";
import * as v from "valibot";

const BoundAddress = v.object({ port: v.number() });

export function baseUrl(server: Server): string {
  return `http://127.0.0.1:${String(v.parse(BoundAddress, server.address()).port)}`;
}
