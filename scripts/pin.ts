import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getAddress } from "viem";

export const CONTRACTS_V2_COMMIT =
  "71a3b7339dbc55ab47667abdfe8303bac4f4c24e" as const;

export const PIN_DEPLOYED_AT = "2026-09-15T09:46:38.513Z" as const;

export const PIN_ADDRESS_DOC_URL =
  `https://raw.githubusercontent.com/ensdomains/contracts-v2/${CONTRACTS_V2_COMMIT}/contracts/docs/addresses/sepolia.md` as const;

export const PIN_DEPLOYMENT_JSON_BASE =
  `https://raw.githubusercontent.com/ensdomains/contracts-v2/${CONTRACTS_V2_COMMIT}/contracts/deployments/sepolia` as const;

const REQUIRED_NAMES = [
  "ETHRegistrar",
  "ETHRegistry",
  "MockDAI",
  "MockUSDC",
  "StandardRentPriceOracle",
] as const;

export const BANNED_OLD_ADDRESSES = [
  "0xdce5205a553573ffd47629327dddf36186022ffa",
  "0x7e4b2d59938930168024201752ee5503df402303",
] as const;

export type PinAddresses = {
  ETHRegistrar: `0x${string}`;
  ETHRegistry: `0x${string}`;
  MockDAI: `0x${string}`;
  MockUSDC: `0x${string}`;
  StandardRentPriceOracle: `0x${string}`;
};

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

function parsePinnedAddress(markdown: string, name: string): `0x${string}` {
  const pattern = new RegExp(
    `\\|\\s*${name}\\s*\\|\\s*\\[(0x[a-fA-F0-9]{40})\\]`,
    "u",
  );
  const match = pattern.exec(markdown);
  if (match === null || match[1] === undefined) {
    throw new Error(
      `DISAGREEMENT: pin address table at ${PIN_ADDRESS_DOC_URL} is missing ${name}`,
    );
  }
  return getAddress(match[1]);
}

export function parsePinAddressesFromMarkdown(markdown: string): PinAddresses {
  if (!markdown.includes(`Deployed at:** ${PIN_DEPLOYED_AT}`)) {
    throw new Error(
      `DISAGREEMENT: local pin markdown Deployed at does not equal ${PIN_DEPLOYED_AT}`,
    );
  }

  for (const banned of BANNED_OLD_ADDRESSES) {
    if (markdown.toLowerCase().includes(banned.toLowerCase())) {
      throw new Error(
        `DISAGREEMENT: banned old address ${banned} appears in pin markdown`,
      );
    }
  }

  const addresses = {} as PinAddresses;
  for (const name of REQUIRED_NAMES) {
    const address = parsePinnedAddress(markdown, name);
    rejectBannedAddress(name, address);
    addresses[name] = address;
  }

  return addresses;
}

export function loadPinAddresses(): PinAddresses {
  const here = dirname(fileURLToPath(import.meta.url));
  const markdown = readFileSync(
    join(here, "pin", "sepolia-addresses.md"),
    "utf8",
  );
  try {
    return parsePinAddressesFromMarkdown(markdown);
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }
}

export function rejectBannedAddress(
  label: string,
  address: `0x${string}`,
): void {
  const normalized = getAddress(address);
  for (const banned of BANNED_OLD_ADDRESSES) {
    if (normalized === getAddress(banned)) {
      throw new Error(
        `DISAGREEMENT: ${label}=${normalized} is a banned older deployment address`,
      );
    }
  }
}
