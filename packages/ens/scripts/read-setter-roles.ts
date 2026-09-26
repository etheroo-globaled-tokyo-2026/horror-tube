import { config as loadDotenv } from "dotenv";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  type Address,
  createPublicClient,
  getAddress,
  http,
  zeroAddress,
} from "viem";
import { sepolia } from "viem/chains";

import { ethRegistryAbi, permissionedResolverAbi } from "./abis.js";
import {
  AGENT_TEXT_KEYS,
  ROLE_SET_TEXT,
  ROSTER_TEXT_KEYS,
  textKeyResource,
} from "./grant-text-roles.js";
import { loadAgentKey, loadBootstrapKey, loadRosterKey, requiredEnv } from "./process-keys.js";
import { loadPinAddresses } from "./pin.js";
import { parseLabel } from "./register-eth-label.js";

loadDotenv({ path: new URL("../../../.env", import.meta.url) });

export { ROLE_SET_TEXT, textKeyResource };
export const SETTER_ROLE_KEYS = [...ROSTER_TEXT_KEYS, ...AGENT_TEXT_KEYS] as const;
export const SETTER_ROLE_ACCOUNTS = ["bootstrap", "roster", "agent"] as const;
const REQUIRED_ENV = [
  "ENS_LABEL",
  "SEPOLIA_RPC_URL",
  "PRIVATE_KEY",
  "ROSTER_PRIVATE_KEY",
  "AGENT_PRIVATE_KEY",
] as const;

export type SetterRoleAccount = (typeof SETTER_ROLE_ACCOUNTS)[number];
export type SetterRoleKey = (typeof SETTER_ROLE_KEYS)[number];
export type KeyRoleRead = { can: boolean; directRole: boolean };
export type KeyAccountsRead = Record<SetterRoleAccount, KeyRoleRead>;
export type SetterRoleRead = {
  rootSetText: Record<SetterRoleAccount, boolean>;
  keys: Record<SetterRoleKey, KeyAccountsRead>;
};

/** Returns one message per account/key that breaks the roster/agent split; empty means pass. */
export function classifySetterRoles(read: SetterRoleRead): string[] {
  const failures: string[] = [];
  const expectRoot: Record<SetterRoleAccount, boolean> = {
    bootstrap: true,
    roster: false,
    agent: false,
  };
  for (const account of SETTER_ROLE_ACCOUNTS) {
    if (read.rootSetText[account] !== expectRoot[account]) {
      failures.push(
        `${account} hasRootRoles(ROLE_SET_TEXT) is ${read.rootSetText[account]}, expected ${expectRoot[account]}`,
      );
    }
  }
  const rosterKeys: readonly string[] = ROSTER_TEXT_KEYS;
  const agentKeys: readonly string[] = AGENT_TEXT_KEYS;
  for (const key of SETTER_ROLE_KEYS) {
    const expected: Record<"roster" | "agent", boolean> = {
      roster: rosterKeys.includes(key),
      agent: agentKeys.includes(key),
    };
    for (const account of ["roster", "agent"] as const) {
      const can = read.keys[key][account].can;
      if (can !== expected[account]) {
        failures.push(
          `${account} hasRoles(${key}, ROLE_SET_TEXT) is ${can}, expected ${expected[account]}`,
        );
      }
    }
  }
  return failures;
}

function redact(message: string, secret: string): string {
  return message.split(secret).join("<SEPOLIA_RPC_URL>");
}

async function main(): Promise<void> {
  for (const name of REQUIRED_ENV) {
    requiredEnv(name);
  }
  const label = parseLabel(process.env.ENS_LABEL);
  const rpcUrl = requiredEnv("SEPOLIA_RPC_URL");
  const addresses: Record<SetterRoleAccount, Address> = {
    bootstrap: loadBootstrapKey().address,
    roster: loadRosterKey().address,
    agent: loadAgentKey().address,
  };
  const pin = loadPinAddresses();
  const client = createPublicClient({ chain: sepolia, transport: http(rpcUrl) });

  try {
    const chainId = await client.getChainId();
    if (chainId !== sepolia.id) {
      throw new Error(`SEPOLIA_RPC_URL reports chain id ${chainId}, expected ${sepolia.id}`);
    }

    const resolver = getAddress(
      await client.readContract({
        address: pin.ETHRegistry,
        abi: ethRegistryAbi,
        functionName: "getResolver",
        args: [label],
      }),
    );
    if (resolver === zeroAddress) {
      throw new Error(
        `ETHRegistry ${pin.ETHRegistry} has no resolver for ENS_LABEL=${label}. Check ENS_LABEL in .env.`,
      );
    }

    const readRoot = (account: SetterRoleAccount): Promise<boolean> =>
      client.readContract({
        address: resolver,
        abi: permissionedResolverAbi,
        functionName: "hasRootRoles",
        args: [ROLE_SET_TEXT, addresses[account]],
      });
    const readKeyAccount = async (
      resource: bigint,
      account: SetterRoleAccount,
    ): Promise<KeyRoleRead> => {
      const [can, bitmap] = await Promise.all([
        client.readContract({
          address: resolver,
          abi: permissionedResolverAbi,
          functionName: "hasRoles",
          args: [resource, ROLE_SET_TEXT, addresses[account]],
        }),
        client.readContract({
          address: resolver,
          abi: permissionedResolverAbi,
          functionName: "roles",
          args: [resource, addresses[account]],
        }),
      ]);
      return { can, directRole: (bitmap & ROLE_SET_TEXT) !== 0n };
    };
    const readKey = async (key: SetterRoleKey): Promise<KeyAccountsRead> => {
      const resource = textKeyResource(key);
      const [bootstrap, roster, agent] = await Promise.all([
        readKeyAccount(resource, "bootstrap"),
        readKeyAccount(resource, "roster"),
        readKeyAccount(resource, "agent"),
      ]);
      return { bootstrap, roster, agent };
    };

    const [rootBootstrap, rootRoster, rootAgent, look, brief, icon, status, injuries] =
      await Promise.all([
        readRoot("bootstrap"),
        readRoot("roster"),
        readRoot("agent"),
        readKey("look"),
        readKey("brief"),
        readKey("icon"),
        readKey("status"),
        readKey("injuries"),
      ]);
    const read: SetterRoleRead = {
      rootSetText: { bootstrap: rootBootstrap, roster: rootRoster, agent: rootAgent },
      keys: { look, brief, icon, status, injuries },
    };

    console.log(
      JSON.stringify(
        {
          chainId,
          name: `${label}.eth`,
          resolver,
          accounts: addresses,
          rootSetText: read.rootSetText,
          keys: read.keys,
        },
        null,
        2,
      ),
    );

    const failures = classifySetterRoles(read);
    if (failures.length > 0) {
      throw new Error(`Setter role split is wrong on ${resolver}:\n${failures.join("\n")}`);
    }
    console.log(
      `PASS: roster sets ${ROSTER_TEXT_KEYS.join(", ")}; agent sets ${AGENT_TEXT_KEYS.join(", ")}`,
    );
  } catch (error) {
    const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
    throw new Error(redact(message, rpcUrl));
  }
}

function isDirectRun(): boolean {
  const entry = process.argv[1];
  if (entry === undefined) {
    return false;
  }
  return import.meta.url === pathToFileURL(resolve(entry)).href;
}

if (isDirectRun()) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
