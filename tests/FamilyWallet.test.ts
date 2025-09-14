import { describe, it, expect, beforeEach } from "vitest";
import { stringAsciiCV, uintCV } from "@stacks/transactions";

const ERR_UNAUTHORIZED = 100;
const ERR_OVER_LIMIT = 101;
const ERR_INSUFFICIENT_BALANCE = 102;
const ERR_INVALID_AMOUNT = 103;
const ERR_INVALID_CATEGORY = 104;
const ERR_MAX_MEMBERS_EXCEEDED = 105;
const ERR_MEMBER_NOT_FOUND = 106;
const ERR_INVALID_ROLE = 107;
const ERR_PERIOD_NOT_RESET = 108;
const ERR_APPROVAL_REQUIRED = 109;
const ERR_INVALID_MEMO = 110;
const ERR_INVALID_PERIOD = 111;
const ERR_WALLET_PAUSED = 112;

interface Member {
  role: string;
  joinedAt: number;
  active: boolean;
}

interface Limit {
  limit: number;
}

interface Usage {
  usage: number;
}

interface Proposal {
  amount: number;
  category: string;
  memo: string;
  proposer: string;
  approvals: number;
  executed: boolean;
  expiresAt: number;
}

interface Balance {
  balance: number;
}

interface Result<T> {
  ok: boolean;
  value: T;
}

class FamilyWalletMock {
  state: {
    totalBalance: number;
    maxMembers: number;
    isPaused: boolean;
    nextProposalId: number;
    approvalThreshold: number;
    members: Map<string, Member>;
    memberLimits: Map<string, Limit>;
    usageTrackers: Map<string, Usage>;
    proposals: Map<number, Proposal>;
    balances: Map<string, Balance>;
  } = {
    totalBalance: 0,
    maxMembers: 10,
    isPaused: false,
    nextProposalId: 0,
    approvalThreshold: 2,
    members: new Map(),
    memberLimits: new Map(),
    usageTrackers: new Map(),
    proposals: new Map(),
    balances: new Map(),
  };
  blockHeight: number = 0;
  caller: string = "ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM";

  constructor() {
    this.reset();
  }

  reset() {
    this.state = {
      totalBalance: 0,
      maxMembers: 10,
      isPaused: false,
      nextProposalId: 0,
      approvalThreshold: 2,
      members: new Map(),
      memberLimits: new Map(),
      usageTrackers: new Map(),
      proposals: new Map(),
      balances: new Map(),
    };
    this.blockHeight = 0;
    this.caller = "ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM";
  }

  getTotalBalance(): Result<number> {
    return { ok: true, value: this.state.totalBalance };
  }

  getMember(who: string): Member | null {
    return this.state.members.get(who) || null;
  }

  getLimit(who: string, cat: string, per: number): Limit | null {
    return this.state.memberLimits.get(`${who}-${cat}-${per}`) || null;
  }

  getUsage(who: string, cat: string, per: number): Usage | null {
    return this.state.usageTrackers.get(`${who}-${cat}-${per}`) || null;
  }

  getProposal(id: number): Proposal | null {
    return this.state.proposals.get(id) || null;
  }

  getMemberBalance(who: string): number {
    return (this.state.balances.get(who)?.balance || 0);
  }

  deposit(amount: number): Result<boolean> {
    if (amount <= 0) return { ok: false, value: false };
    if (this.state.isPaused) return { ok: false, value: false };
    const currentMembers = Array.from(this.state.members.values()).filter(m => m.active).length;
    if (currentMembers >= this.state.maxMembers && !this.getMember(this.caller)) return { ok: false, value: false };
    let newBal = this.getMemberBalance(this.caller) + amount;
    if (!this.getMember(this.caller)) {
      this.state.members.set(this.caller, { role: "member", joinedAt: this.blockHeight, active: true });
      this.state.balances.set(this.caller, { balance: amount });
    } else {
      this.state.balances.set(this.caller, { balance: newBal });
    }
    this.state.totalBalance += amount;
    return { ok: true, value: true };
  }

  withdraw(amount: number, memo: string, category: string, period: number): Result<boolean> {
    if (amount <= 0) return { ok: false, value: false };
    if (memo.length > 34) return { ok: false, value: false };
    if (!["groceries", "fun", "bills", "transport", "other"].includes(category)) return { ok: false, value: false };
    if (![86400, 604800, 2592000].includes(period)) return { ok: false, value: false };
    if (this.state.isPaused) return { ok: false, value: false };
    const mem = this.getMember(this.caller);
    if (!mem || !mem.active) return { ok: false, value: false };
    const role = mem.role;
    const totBal = this.state.totalBalance;
    if (role === "owner") {
      if (totBal < amount) return { ok: false, value: false };
      this.state.totalBalance -= amount;
      this.state.balances.set(this.caller, { balance: this.getMemberBalance(this.caller) - amount });
      return { ok: true, value: true };
    } else if (role === "member") {
      const lim = this.getLimit(this.caller, category, period)?.limit || 0;
      const used = this.getUsage(this.caller, category, period)?.usage || 0;
      const rem = lim - used;
      if (rem >= amount) {
        if (totBal < amount) return { ok: false, value: false };
        this.state.usageTrackers.set(`${this.caller}-${category}-${per}`, { usage: used + amount });
        this.state.totalBalance -= amount;
        this.state.balances.set(this.caller, { balance: this.getMemberBalance(this.caller) - amount });
        return { ok: true, value: true };
      } else if (lim > 0) {
        return { ok: false, value: false };
      } else {
        return { ok: false, value: false };
      }
    } else {
      return { ok: false, value: false };
    }
  }

  createProposal(amount: number, memo: string, category: string, period: number): Result<number> {
    if (amount <= 0) return { ok: false, value: 0 };
    if (memo.length > 34) return { ok: false, value: 0 };
    if (!["groceries", "fun", "bills", "transport", "other"].includes(category)) return { ok: false, value: 0 };
    if (![86400, 604800, 2592000].includes(period)) return { ok: false, value: 0 };
    if (!this.getMember(this.caller)) return { ok: false, value: 0 };
    const exp = this.blockHeight + 5040;
    const id = this.state.nextProposalId;
    this.state.proposals.set(id, {
      amount,
      category,
      memo,
      proposer: this.caller,
      approvals: 0,
      executed: false,
      expiresAt: exp,
    });
    this.state.nextProposalId++;
    return { ok: true, value: id };
  }

  approveProposal(id: number): Result<boolean> {
    const prop = this.getProposal(id);
    if (!prop) return { ok: false, value: false };
    if (!this.getMember(this.caller)) return { ok: false, value: false };
    if (prop.executed) return { ok: false, value: false };
    if (this.blockHeight >= prop.expiresAt) return { ok: false, value: false };
    const newApps = prop.approvals + 1;
    if (newApps >= this.state.approvalThreshold) {
      this.state.proposals.set(id, { ...prop, approvals: newApps, executed: true });
      this.executeApprovedWithdraw(prop.amount, prop.category, prop.proposer);
      return { ok: true, value: true };
    } else {
      this.state.proposals.set(id, { ...prop, approvals: newApps });
      return { ok: true, value: true };
    }
  }

  private executeApprovedWithdraw(amount: number, category: string, to: string): void {
    if (this.state.totalBalance < amount) return;
    this.state.totalBalance -= amount;
    this.state.balances.set(to, { balance: this.getMemberBalance(to) - amount });
    const per = 604800;
    const used = this.getUsage(to, category, per)?.usage || 0;
    this.state.usageTrackers.set(`${to}-${category}-${per}`, { usage: used + amount });
  }

  setLimit(who: string, cat: string, lim: number, per: number): Result<boolean> {
    if (!this.isOwner()) return { ok: false, value: false };
    if (!["groceries", "fun", "bills", "transport", "other"].includes(cat)) return { ok: false, value: false };
    if (![86400, 604800, 2592000].includes(per)) return { ok: false, value: false };
    if (lim <= 0) return { ok: false, value: false };
    this.state.memberLimits.set(`${who}-${cat}-${per}`, { limit: lim });
    return { ok: true, value: true };
  }

  resetUsage(who: string, cat: string, per: number): Result<boolean> {
    if (!this.isOwner()) return { ok: false, value: false };
    this.state.usageTrackers.set(`${who}-${cat}-${per}`, { usage: 0 });
    return { ok: true, value: true };
  }

  pauseWallet(pause: boolean): Result<boolean> {
    if (!this.isOwner()) return { ok: false, value: false };
    this.state.isPaused = pause;
    return { ok: true, value: true };
  }

  addMember(who: string, role: string): Result<boolean> {
    if (!this.isOwner()) return { ok: false, value: false };
    if (!["member", "viewer"].includes(role)) return { ok: false, value: false };
    if (this.getMember(who)) return { ok: false, value: false };
    this.state.members.set(who, { role, joinedAt: this.blockHeight, active: true });
    return { ok: true, value: true };
  }

  removeMember(who: string): Result<boolean> {
    if (!this.isOwner()) return { ok: false, value: false };
    const mem = this.getMember(who);
    if (!mem) return { ok: false, value: false };
    this.state.members.set(who, { ...mem, active: false });
    return { ok: true, value: true };
  }

  private isOwner(): boolean {
    const mem = this.getMember(this.caller);
    return mem?.role === "owner";
  }
}

describe("FamilyWallet", () => {
  let contract: FamilyWalletMock;

  beforeEach(() => {
    contract = new FamilyWalletMock();
    contract.reset();
    contract.caller = "ST1OWNER";
    contract.addMember("ST1OWNER", "owner");
  });

  it("deposits successfully", () => {
    contract.caller = "ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM";
    const result = contract.deposit(1000);
    expect(result.ok).toBe(true);
    expect(result.value).toBe(true);
    expect(contract.getTotalBalance().value).toBe(1000);
    const mem = contract.getMember("ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM");
    expect(mem?.role).toBe("member");
    expect(mem?.active).toBe(true);
  });

  it("rejects deposit with zero amount", () => {
    const result = contract.deposit(0);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(false);
  });

  it("rejects deposit over max members", () => {
    for (let i = 0; i < 10; i++) {
      contract.caller = `ST1MEMBER${i}`;
      contract.addMember(`ST1MEMBER${i}`, "member");
      contract.deposit(100);
    }
    contract.caller = "ST1NEW";
    const result = contract.deposit(100);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(false);
  });

  it("rejects owner withdraw insufficient balance", () => {
    contract.caller = "ST1OWNER";
    const result = contract.withdraw(100, "groceries", "bills", 604800);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(false);
  });

  it("rejects member withdraw over limit", () => {
    contract.caller = "ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM";
    contract.deposit(2000);
    contract.caller = "ST1OWNER";
    contract.addMember("ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM", "member");
    contract.setLimit("ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM", "bills", 200, 604800);
    contract.caller = "ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM";
    const result = contract.withdraw(300, "memo", "bills", 604800);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(false);
  });

  it("requires approval for over limit", () => {
    contract.caller = "ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM";
    contract.deposit(2000);
    contract.caller = "ST1OWNER";
    contract.addMember("ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM", "member");
    contract.setLimit("ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM", "bills", 200, 604800);
    contract.caller = "ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM";
    const result = contract.withdraw(300, "memo", "bills", 604800);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(false);
  });

  it("rejects withdraw invalid category", () => {
    contract.caller = "ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM";
    contract.deposit(1000);
    contract.caller = "ST1OWNER";
    contract.addMember("ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM", "member");
    contract.caller = "ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM";
    const result = contract.withdraw(100, "memo", "invalid", 604800);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(false);
  });

  it("rejects withdraw invalid period", () => {
    contract.caller = "ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM";
    contract.deposit(1000);
    contract.caller = "ST1OWNER";
    contract.addMember("ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM", "member");
    contract.caller = "ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM";
    const result = contract.withdraw(100, "memo", "bills", 1);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(false);
  });

  it("rejects withdraw when paused", () => {
    contract.caller = "ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM";
    contract.deposit(1000);
    contract.caller = "ST1OWNER";
    contract.addMember("ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM", "member");
    contract.pauseWallet(true);
    contract.caller = "ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM";
    const result = contract.withdraw(100, "memo", "bills", 604800);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(false);
  });

  it("rejects withdraw non-member", () => {
    contract.caller = "ST1FAKE";
    const result = contract.withdraw(100, "memo", "bills", 604800);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(false);
  });

  it("creates proposal successfully", () => {
    contract.caller = "ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM";
    contract.deposit(1000);
    contract.caller = "ST1OWNER";
    contract.addMember("ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM", "member");
    contract.caller = "ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM";
    const result = contract.createProposal(500, "memo", "bills", 604800);
    expect(result.ok).toBe(true);
    expect(result.value).toBe(0);
    const prop = contract.getProposal(0);
    expect(prop?.amount).toBe(500);
    expect(prop?.category).toBe("bills");
    expect(prop?.memo).toBe("memo");
    expect(prop?.proposer).toBe("ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM");
    expect(prop?.approvals).toBe(0);
    expect(prop?.executed).toBe(false);
  });

  it("rejects proposal invalid amount", () => {
    contract.caller = "ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM";
    contract.deposit(1000);
    contract.caller = "ST1OWNER";
    contract.addMember("ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM", "member");
    contract.caller = "ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM";
    const result = contract.createProposal(0, "memo", "bills", 604800);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(0);
  });

  it("rejects proposal non-member", () => {
    contract.caller = "ST1FAKE";
    const result = contract.createProposal(500, "memo", "bills", 604800);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(0);
  });

  it("rejects approve non-member", () => {
    contract.caller = "ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM";
    contract.deposit(1000);
    contract.caller = "ST1OWNER";
    contract.addMember("ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM", "member");
    contract.caller = "ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM";
    contract.createProposal(500, "memo", "bills", 604800);
    contract.caller = "ST1FAKE";
    const result = contract.approveProposal(0);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(false);
  });

  it("rejects approve expired", () => {
    contract.caller = "ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM";
    contract.deposit(1000);
    contract.caller = "ST1OWNER";
    contract.addMember("ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM", "member");
    contract.caller = "ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM";
    contract.createProposal(500, "memo", "bills", 604800);
    contract.blockHeight = 6000;
    const result = contract.approveProposal(0);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(false);
  });

  it("rejects set limit non-owner", () => {
    contract.caller = "ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM";
    const result = contract.setLimit("ST1MEMBER", "bills", 1000, 604800);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(false);
  });

  it("rejects add member non-owner", () => {
    contract.caller = "ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM";
    const result = contract.addMember("ST1MEMBER", "member");
    expect(result.ok).toBe(false);
    expect(result.value).toBe(false);
  });

  it("rejects add existing member", () => {
    contract.caller = "ST1OWNER";
    contract.addMember("ST1MEMBER", "member");
    const result = contract.addMember("ST1MEMBER", "member");
    expect(result.ok).toBe(false);
    expect(result.value).toBe(false);
  });

  it("rejects remove non-member", () => {
    contract.caller = "ST1OWNER";
    const result = contract.removeMember("ST1FAKE");
    expect(result.ok).toBe(false);
    expect(result.value).toBe(false);
  });

  it("parses ascii string with Clarity", () => {
    const cv = stringAsciiCV("bills");
    expect(cv.value).toBe("bills");
  });

  it("parses uint with Clarity", () => {
    const cv = uintCV(1000);
    expect(Number(cv.value)).toBe(1000);
  });
});