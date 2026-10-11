// Require two consecutive samples before accepting a network change. Windows
// can briefly report an old USB network while its adapter is disconnecting.
export const advanceNetworkObservation = (previous, identity) => {
  const fingerprint = identity?.connected ? (identity.fingerprint || '') : '';
  if (!fingerprint) return { fingerprint: '', count: 0, confirmed: false };

  const count = previous?.fingerprint === fingerprint
    ? Math.min((previous.count || 0) + 1, 2)
    : 1;
  return { fingerprint, count, confirmed: count === 2 };
};
