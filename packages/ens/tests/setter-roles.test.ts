import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { AGENT_TEXT_KEYS, ROSTER_TEXT_KEYS } from "../scripts/grant-text-roles.js";
import {
  SETTER_ROLE_KEYS,
  type KeyAccountsRead,
  type SetterRoleAccount,
  type SetterRoleKey,
  type SetterRoleRead,
  classifySetterRoles,
} from "../scripts/read-setter-roles.js";

const rosterKeys: readonly string[] = ROSTER_TEXT_KEYS;
const agentKeys: readonly string[] = AGENT_TEXT_KEYS;

function passingKey(key: SetterRoleKey): KeyAccountsRead {
  const roster = rosterKeys.includes(key);
  const agent = agentKeys.includes(key);
  return {
    bootstrap: { can: true, directRole: false },
    roster: { can: roster, directRole: roster },
    agent: { can: agent, directRole: agent },
  };
}

function passingRead(): SetterRoleRead {
  return {
    rootSetText: { bootstrap: true, roster: false, agent: false },
    keys: {
      look: passingKey("look"),
      brief: passingKey("brief"),
      icon: passingKey("icon"),
      status: passingKey("status"),
      injuries: passingKey("injuries"),
    },
  };
}

function withKey(key: SetterRoleKey, account: SetterRoleAccount, can: boolean): SetterRoleRead {
  const read = passingRead();
  read.keys[key][account] = { can, directRole: can };
  return read;
}

describe("classifySetterRoles (unit, no network)", () => {
  it("passes the roster/agent split", () => {
    assert.deepEqual(classifySetterRoles(passingRead()), []);
  });

  it("fails when a restricted account holds the root role", () => {
    for (const account of ["roster", "agent"] as const) {
      const read = passingRead();
      read.rootSetText[account] = true;
      const failures = classifySetterRoles(read);
      assert.equal(failures.length, 1);
      assert.match(failures[0] ?? "", new RegExp(`^${account} hasRootRoles`));
    }
  });

  it("fails when bootstrap lost the root role", () => {
    const read = passingRead();
    read.rootSetText.bootstrap = false;
    assert.match(classifySetterRoles(read)[0] ?? "", /^bootstrap hasRootRoles/);
  });

  it("names the account and key for every flipped key role", () => {
    for (const key of SETTER_ROLE_KEYS) {
      for (const account of ["roster", "agent"] as const) {
        const current = passingRead().keys[key][account].can;
        const failures = classifySetterRoles(withKey(key, account, !current));
        assert.equal(failures.length, 1, `${account}/${key}`);
        assert.match(failures[0] ?? "", new RegExp(`^${account} hasRoles\\(${key},`));
      }
    }
  });

  it("does not judge bootstrap per-key reads", () => {
    for (const key of SETTER_ROLE_KEYS) {
      assert.deepEqual(classifySetterRoles(withKey(key, "bootstrap", false)), []);
    }
  });
});
