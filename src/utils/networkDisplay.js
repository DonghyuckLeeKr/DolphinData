const includesAny = (value, terms) => terms.some(term => value.includes(term));

export const getNetworkConnectionKind = (networkMetadata = {}) => {
  const metadata = networkMetadata && typeof networkMetadata === 'object'
    ? networkMetadata
    : {};
  const adapterText = [
    metadata.interfaceName,
    metadata.interfaceDescription,
    metadata.networkConnectionType
  ]
    .filter(value => typeof value === 'string')
    .join(' ')
    .toLowerCase();

  if (includesAny(adapterText, ['wi-fi', 'wifi', 'wireless', 'wlan', '802.11', '무선'])) {
    return 'wifi';
  }
  if (includesAny(adapterText, ['cellular', 'wwan', 'mobile broadband', 'lte', '4g', '5g', 'rndis', 'ndis', 'mbim'])) {
    return 'mobile-router';
  }
  if (includesAny(adapterText, ['ethernet', '802.3', '유선'])) {
    return 'ethernet';
  }
  return 'network';
};

export const getNetworkDisplayInfo = (networkMetadata = {}) => {
  const kind = getNetworkConnectionKind(networkMetadata);
  if (kind === 'wifi') {
    return {
      kind,
      label: 'Wi-Fi',
      trafficDescription: 'Wi-Fi로 주고받는 양',
      pingTitle: 'Wi-Fi 응답 속도 (Ping)'
    };
  }
  if (kind === 'mobile-router') {
    return {
      kind,
      label: '모바일 라우터',
      trafficDescription: '모바일 라우터로 주고받는 양',
      pingTitle: '모바일 라우터 응답 속도 (Ping)'
    };
  }
  if (kind === 'ethernet') {
    return {
      kind,
      label: '유선 네트워크',
      trafficDescription: '유선으로 주고받는 양',
      pingTitle: '유선 응답 속도 (Ping)'
    };
  }
  return {
    kind,
    label: '네트워크',
    trafficDescription: '지금 네트워크로 주고받는 양',
    pingTitle: '응답 속도 (Ping)'
  };
};
