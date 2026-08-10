import { expect } from "chai";
import { network } from "hardhat";

const { ethers, networkHelpers } = await network.create();

const DIRECTION_SHORT = 1;
const DIRECTION_LONG = 2;

const OUTCOME_TARGET_HIT = 1;
const OUTCOME_STOP_HIT = 2;
const OUTCOME_EXPIRED = 3;

// publishSignal is overloaded; ethers/TypeChain require the full signature
// to disambiguate which overload to call.
const PUBLISH_SIGNAL =
  "publishSignal(string,uint8,uint8,uint256,uint256,uint256,uint256)" as const;
const PUBLISH_SIGNAL_DEFAULT =
  "publishSignal(string,uint8,uint8,uint256,uint256,uint256)" as const;

// Valid price triples satisfying the directional stop/target validation.
const LONG_ENTRY = 200n;
const LONG_STOP = 100n;
const LONG_TARGET = 300n;
const SHORT_ENTRY = 200n;
const SHORT_STOP = 300n;
const SHORT_TARGET = 100n;

async function deploySignalLedgerFixture() {
  const [owner, other] = await ethers.getSigners();
  const signalLedger = await ethers.deployContract("SignalLedger");
  return { signalLedger, owner, other };
}

describe("SignalLedger", function () {
  it("publishSignal stores correct values and emits the event", async function () {
    const { signalLedger } = await networkHelpers.loadFixture(deploySignalLedgerFixture);

    const now = BigInt(await networkHelpers.time.latest());
    const expiresAt = now + 3600n;

    const tx = signalLedger[PUBLISH_SIGNAL](
      "ETH",
      DIRECTION_LONG,
      7,
      300_000_000_000n,
      290_000_000_000n,
      320_000_000_000n,
      expiresAt,
    );

    await expect(tx).to.emit(signalLedger, "SignalPublished");

    const signal = await signalLedger.getSignal(1n);
    expect(signal.id).to.equal(1n);
    expect(signal.token).to.equal("ETH");
    expect(signal.direction).to.equal(DIRECTION_LONG);
    expect(signal.score).to.equal(7);
    expect(signal.entryPrice).to.equal(300_000_000_000n);
    expect(signal.stopPrice).to.equal(290_000_000_000n);
    expect(signal.targetPrice).to.equal(320_000_000_000n);
    expect(signal.expiresAt).to.equal(expiresAt);
    expect(signal.resolved).to.equal(false);
    expect(signal.outcome).to.equal(0);
    expect(signal.exitPrice).to.equal(0n);
    expect(signal.resolvedAt).to.equal(0n);
    expect(signal.publishedAt).to.be.greaterThan(0n);
  });

  it("reverts when a non-owner calls publishSignal", async function () {
    const { signalLedger, other } = await networkHelpers.loadFixture(deploySignalLedgerFixture);
    const now = BigInt(await networkHelpers.time.latest());

    await expect(
      signalLedger
        .connect(other)
        [PUBLISH_SIGNAL]("ETH", DIRECTION_LONG, 5, 1n, 1n, 1n, now + 3600n),
    ).to.be.revertedWith("SignalLedger: caller is not the owner");
  });

  it("reverts when a non-owner calls resolveSignal", async function () {
    const { signalLedger, other } = await networkHelpers.loadFixture(deploySignalLedgerFixture);
    const now = BigInt(await networkHelpers.time.latest());

    await signalLedger[PUBLISH_SIGNAL](
      "ETH",
      DIRECTION_LONG,
      5,
      LONG_ENTRY,
      LONG_STOP,
      LONG_TARGET,
      now + 3600n,
    );

    await expect(
      signalLedger.connect(other).resolveSignal(1n, OUTCOME_TARGET_HIT, LONG_TARGET),
    ).to.be.revertedWith("SignalLedger: caller is not the owner");
  });

  it("the no-expiry overload defaults expiresAt to 24 hours out", async function () {
    const { signalLedger } = await networkHelpers.loadFixture(deploySignalLedgerFixture);

    const tx = await signalLedger[PUBLISH_SIGNAL_DEFAULT](
      "BTC",
      DIRECTION_SHORT,
      4,
      SHORT_ENTRY,
      SHORT_STOP,
      SHORT_TARGET,
    );
    const receipt = await tx.wait();
    const block = await ethers.provider.getBlock(receipt!.blockNumber);
    const defaultExpiryWindow = await signalLedger.DEFAULT_EXPIRY_WINDOW();

    const signal = await signalLedger.getSignal(1n);
    expect(signal.expiresAt).to.equal(BigInt(block!.timestamp) + defaultExpiryWindow);
  });

  it("reverts when resolving an already-resolved signal", async function () {
    const { signalLedger } = await networkHelpers.loadFixture(deploySignalLedgerFixture);
    const now = BigInt(await networkHelpers.time.latest());

    await signalLedger[PUBLISH_SIGNAL](
      "ETH",
      DIRECTION_LONG,
      5,
      LONG_ENTRY,
      LONG_STOP,
      LONG_TARGET,
      now + 3600n,
    );
    await signalLedger.resolveSignal(1n, OUTCOME_TARGET_HIT, LONG_TARGET);

    await expect(
      signalLedger.resolveSignal(1n, OUTCOME_TARGET_HIT, LONG_TARGET),
    ).to.be.revertedWith("SignalLedger: already resolved");
  });

  it("reverts when resolving a nonexistent signal", async function () {
    const { signalLedger } = await networkHelpers.loadFixture(deploySignalLedgerFixture);

    await expect(
      signalLedger.resolveSignal(1n, OUTCOME_TARGET_HIT, 1n),
    ).to.be.revertedWith("SignalLedger: signal does not exist");
  });

  it("reverts on an invalid direction", async function () {
    const { signalLedger } = await networkHelpers.loadFixture(deploySignalLedgerFixture);
    const now = BigInt(await networkHelpers.time.latest());

    await expect(
      signalLedger[PUBLISH_SIGNAL]("ETH", 3, 5, 1n, 1n, 1n, now + 3600n),
    ).to.be.revertedWith("SignalLedger: invalid direction");
  });

  it("reverts when score is above 10", async function () {
    const { signalLedger } = await networkHelpers.loadFixture(deploySignalLedgerFixture);
    const now = BigInt(await networkHelpers.time.latest());

    await expect(
      signalLedger[PUBLISH_SIGNAL]("ETH", DIRECTION_LONG, 11, 1n, 1n, 1n, now + 3600n),
    ).to.be.revertedWith("SignalLedger: score above 10");
  });

  it("reverts on an invalid outcome", async function () {
    const { signalLedger } = await networkHelpers.loadFixture(deploySignalLedgerFixture);
    const now = BigInt(await networkHelpers.time.latest());

    await signalLedger[PUBLISH_SIGNAL](
      "ETH",
      DIRECTION_LONG,
      5,
      LONG_ENTRY,
      LONG_STOP,
      LONG_TARGET,
      now + 3600n,
    );

    await expect(signalLedger.resolveSignal(1n, 4, 1n)).to.be.revertedWith(
      "SignalLedger: invalid outcome",
    );
  });

  it("getStats tallies wins and losses correctly", async function () {
    const { signalLedger } = await networkHelpers.loadFixture(deploySignalLedgerFixture);
    const now = BigInt(await networkHelpers.time.latest());
    const expiresAt = now + 3600n;

    await signalLedger[PUBLISH_SIGNAL]("A", DIRECTION_LONG, 5, LONG_ENTRY, LONG_STOP, LONG_TARGET, expiresAt);
    await signalLedger[PUBLISH_SIGNAL]("B", DIRECTION_LONG, 5, LONG_ENTRY, LONG_STOP, LONG_TARGET, expiresAt);
    await signalLedger[PUBLISH_SIGNAL]("C", DIRECTION_LONG, 5, LONG_ENTRY, LONG_STOP, LONG_TARGET, expiresAt);
    await signalLedger[PUBLISH_SIGNAL]("D", DIRECTION_LONG, 5, LONG_ENTRY, LONG_STOP, LONG_TARGET, expiresAt);

    await signalLedger.resolveSignal(1n, OUTCOME_TARGET_HIT, LONG_TARGET);
    await signalLedger.resolveSignal(2n, OUTCOME_STOP_HIT, LONG_STOP);
    await signalLedger.resolveSignal(3n, OUTCOME_EXPIRED, 1n);
    // Signal 4 is left unresolved, but has not expired yet.

    const stats = await signalLedger.getStats();
    expect(stats.totalPublished).to.equal(4n);
    expect(stats.totalResolved).to.equal(3n);
    expect(stats.wins).to.equal(1n);
    expect(stats.losses).to.equal(2n);
    expect(stats.unresolvedExpired).to.equal(0n);
  });

  it("counts an unresolved signal past its expiry as unresolvedExpired", async function () {
    const { signalLedger } = await networkHelpers.loadFixture(deploySignalLedgerFixture);
    const now = BigInt(await networkHelpers.time.latest());
    const expiresAt = now + 3600n;

    await signalLedger[PUBLISH_SIGNAL](
      "ETH",
      DIRECTION_LONG,
      5,
      LONG_ENTRY,
      LONG_STOP,
      LONG_TARGET,
      expiresAt,
    );

    await networkHelpers.time.increaseTo(expiresAt + 1n);

    const stats = await signalLedger.getStats();
    expect(stats.totalPublished).to.equal(1n);
    expect(stats.totalResolved).to.equal(0n);
    expect(stats.wins).to.equal(0n);
    expect(stats.unresolvedExpired).to.equal(1n);
    expect(stats.losses).to.equal(1n);
  });

  it("reverts when a short's stopPrice is not above entryPrice", async function () {
    const { signalLedger } = await networkHelpers.loadFixture(deploySignalLedgerFixture);
    const now = BigInt(await networkHelpers.time.latest());

    await expect(
      signalLedger[PUBLISH_SIGNAL](
        "ETH",
        DIRECTION_SHORT,
        5,
        SHORT_ENTRY,
        SHORT_ENTRY, // stopPrice == entryPrice, not above it
        SHORT_TARGET,
        now + 3600n,
      ),
    ).to.be.revertedWith("SignalLedger: short stopPrice must be above entryPrice");
  });

  it("reverts when a short's targetPrice is not below entryPrice", async function () {
    const { signalLedger } = await networkHelpers.loadFixture(deploySignalLedgerFixture);
    const now = BigInt(await networkHelpers.time.latest());

    await expect(
      signalLedger[PUBLISH_SIGNAL](
        "ETH",
        DIRECTION_SHORT,
        5,
        SHORT_ENTRY,
        SHORT_STOP,
        SHORT_ENTRY, // targetPrice == entryPrice, not below it
        now + 3600n,
      ),
    ).to.be.revertedWith("SignalLedger: short targetPrice must be below entryPrice");
  });

  it("reverts when a long's stopPrice is not below entryPrice", async function () {
    const { signalLedger } = await networkHelpers.loadFixture(deploySignalLedgerFixture);
    const now = BigInt(await networkHelpers.time.latest());

    await expect(
      signalLedger[PUBLISH_SIGNAL](
        "ETH",
        DIRECTION_LONG,
        5,
        LONG_ENTRY,
        LONG_ENTRY, // stopPrice == entryPrice, not below it
        LONG_TARGET,
        now + 3600n,
      ),
    ).to.be.revertedWith("SignalLedger: long stopPrice must be below entryPrice");
  });

  it("reverts when a long's targetPrice is not above entryPrice", async function () {
    const { signalLedger } = await networkHelpers.loadFixture(deploySignalLedgerFixture);
    const now = BigInt(await networkHelpers.time.latest());

    await expect(
      signalLedger[PUBLISH_SIGNAL](
        "ETH",
        DIRECTION_LONG,
        5,
        LONG_ENTRY,
        LONG_STOP,
        LONG_ENTRY, // targetPrice == entryPrice, not above it
        now + 3600n,
      ),
    ).to.be.revertedWith("SignalLedger: long targetPrice must be above entryPrice");
  });

  it("reverts when a short's target-hit exitPrice is above targetPrice", async function () {
    const { signalLedger } = await networkHelpers.loadFixture(deploySignalLedgerFixture);
    const now = BigInt(await networkHelpers.time.latest());

    await signalLedger[PUBLISH_SIGNAL](
      "ETH",
      DIRECTION_SHORT,
      5,
      SHORT_ENTRY,
      SHORT_STOP,
      SHORT_TARGET,
      now + 3600n,
    );

    await expect(
      signalLedger.resolveSignal(1n, OUTCOME_TARGET_HIT, SHORT_TARGET + 1n),
    ).to.be.revertedWith("SignalLedger: exitPrice does not confirm target hit");
  });

  it("reverts when a short's stop-hit exitPrice is below stopPrice", async function () {
    const { signalLedger } = await networkHelpers.loadFixture(deploySignalLedgerFixture);
    const now = BigInt(await networkHelpers.time.latest());

    await signalLedger[PUBLISH_SIGNAL](
      "ETH",
      DIRECTION_SHORT,
      5,
      SHORT_ENTRY,
      SHORT_STOP,
      SHORT_TARGET,
      now + 3600n,
    );

    await expect(
      signalLedger.resolveSignal(1n, OUTCOME_STOP_HIT, SHORT_STOP - 1n),
    ).to.be.revertedWith("SignalLedger: exitPrice does not confirm stop hit");
  });

  it("reverts when a long's target-hit exitPrice is below targetPrice", async function () {
    const { signalLedger } = await networkHelpers.loadFixture(deploySignalLedgerFixture);
    const now = BigInt(await networkHelpers.time.latest());

    await signalLedger[PUBLISH_SIGNAL](
      "ETH",
      DIRECTION_LONG,
      5,
      LONG_ENTRY,
      LONG_STOP,
      LONG_TARGET,
      now + 3600n,
    );

    await expect(
      signalLedger.resolveSignal(1n, OUTCOME_TARGET_HIT, LONG_TARGET - 1n),
    ).to.be.revertedWith("SignalLedger: exitPrice does not confirm target hit");
  });

  it("reverts when a long's stop-hit exitPrice is above stopPrice", async function () {
    const { signalLedger } = await networkHelpers.loadFixture(deploySignalLedgerFixture);
    const now = BigInt(await networkHelpers.time.latest());

    await signalLedger[PUBLISH_SIGNAL](
      "ETH",
      DIRECTION_LONG,
      5,
      LONG_ENTRY,
      LONG_STOP,
      LONG_TARGET,
      now + 3600n,
    );

    await expect(
      signalLedger.resolveSignal(1n, OUTCOME_STOP_HIT, LONG_STOP + 1n),
    ).to.be.revertedWith("SignalLedger: exitPrice does not confirm stop hit");
  });
});
