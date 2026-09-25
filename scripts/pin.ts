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

const EXPECTED = {
  ETHRegistrar: "0xabe76f6c8dfced81aa5a2bb8034202a7136b94ca",
  ETHRegistry: "0x657ea849311d3d5823348dded7c2aaafb3ede09e",
  MockDAI: "0x278053acc97888e63ec81c80fec641bf0bf19664",
  MockUSDC: "0x16f95d91dba7da3aca778ec053df0ff6c6a8aa8e",
  PermissionedResolverImpl: "0x14f09fd05d4585759e54844dc9b00147131cf243",
  UserRegistryImpl: "0xa80338aaa8d23831cea25e858d1774534abb0263",
  VerifiableFactory: "0x9e726eb570beb6bceb495ab8cda7df517d4e841c",
  StandardRentPriceOracle: "0x9b0b9c65bdaf9794ff7697e4dcfb1f50581072bb",
} as const;

const BANNED_OLD_ADDRESSES = [
  "0xdce5205a553573ffd47629327dddf36186022ffa",
  "0x7e4b2d59938930168024201752ee5503df402303",
] as const;

export type PinAddresses = {
  ETHRegistrar: `0x${string}`;
  ETHRegistry: `0x${string}`;
  MockDAI: `0x${string}`;
  MockUSDC: `0x${string}`;
  PermissionedResolverImpl: `0x${string}`;
  UserRegistryImpl: `0x${string}`;
  VerifiableFactory: `0x${string}`;
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
    fail(
      `DISAGREEMENT: pin address table at ${PIN_ADDRESS_DOC_URL} is missing ${name}`,
    );
  }
  return getAddress(match[1]);
}

export function loadPinAddresses(): PinAddresses {
  const here = dirname(fileURLToPath(import.meta.url));
  const markdown = readFileSync(
    join(here, "pin", "sepolia-addresses.md"),
    "utf8",
  );

  if (!markdown.includes(`Deployed at:** ${PIN_DEPLOYED_AT}`)) {
    fail(
      `DISAGREEMENT: local pin markdown Deployed at does not equal ${PIN_DEPLOYED_AT}`,
    );
  }

  const ethRegistrar = parsePinnedAddress(markdown, "ETHRegistrar");
  const ethRegistry = parsePinnedAddress(markdown, "ETHRegistry");
  const mockDai = parsePinnedAddress(markdown, "MockDAI");
  const mockUsdc = parsePinnedAddress(markdown, "MockUSDC");
  const permissionedResolverImpl = parsePinnedAddress(
    markdown,
    "PermissionedResolverImpl",
  );
  const userRegistryImpl = parsePinnedAddress(markdown, "UserRegistryImpl");
  const verifiableFactory = parsePinnedAddress(markdown, "VerifiableFactory");
  const standardRentPriceOracle = parsePinnedAddress(
    markdown,
    "StandardRentPriceOracle",
  );

  const checks: Array<[string, `0x${string}`, string]> = [
    ["ETHRegistrar", ethRegistrar, EXPECTED.ETHRegistrar],
    ["ETHRegistry", ethRegistry, EXPECTED.ETHRegistry],
    ["MockDAI", mockDai, EXPECTED.MockDAI],
    ["MockUSDC", mockUsdc, EXPECTED.MockUSDC],
    [
      "PermissionedResolverImpl",
      permissionedResolverImpl,
      EXPECTED.PermissionedResolverImpl,
    ],
    ["UserRegistryImpl", userRegistryImpl, EXPECTED.UserRegistryImpl],
    ["VerifiableFactory", verifiableFactory, EXPECTED.VerifiableFactory],
    [
      "StandardRentPriceOracle",
      standardRentPriceOracle,
      EXPECTED.StandardRentPriceOracle,
    ],
  ];

  for (const [name, fromDoc, expectedRaw] of checks) {
    const expected = getAddress(expectedRaw);
    if (fromDoc !== expected) {
      fail(
        `DISAGREEMENT: ${name} in pin markdown is ${fromDoc}, expected ${expected} from task pin`,
      );
    }
  }

  for (const banned of BANNED_OLD_ADDRESSES) {
    if (markdown.toLowerCase().includes(banned.toLowerCase())) {
      fail(
        `DISAGREEMENT: banned old address ${banned} appears in pin markdown`,
      );
    }
  }

  return {
    ETHRegistrar: ethRegistrar,
    ETHRegistry: ethRegistry,
    MockDAI: mockDai,
    MockUSDC: mockUsdc,
    PermissionedResolverImpl: permissionedResolverImpl,
    UserRegistryImpl: userRegistryImpl,
    VerifiableFactory: verifiableFactory,
    StandardRentPriceOracle: standardRentPriceOracle,
  };
}

export function rejectBannedAddress(
  label: string,
  address: `0x${string}`,
): void {
  const normalized = getAddress(address);
  for (const banned of BANNED_OLD_ADDRESSES) {
    if (normalized === getAddress(banned)) {
      fail(
        `DISAGREEMENT: ${label}=${normalized} is a banned older deployment address`,
      );
    }
  }
}
