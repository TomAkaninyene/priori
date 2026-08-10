export function HowItWorks() {
  return (
    <section className="how">
      <h2 className="how__heading">How this works</h2>
      <p>
        Every signal is published on-chain before its outcome is known -- entry, stop, and target prices are
        recorded at publish time and can never be changed afterward.
      </p>
      <p>
        The <code>SignalLedger</code> contract has no edit or delete function, for anyone, including its owner.
        Once a signal is published, its record is permanent.
      </p>
      <p>
        A signal left unresolved past its expiry still counts against the record: the contract folds
        unresolved-expired signals into the loss tally, so staying silent can never improve the track record.
      </p>
    </section>
  );
}
