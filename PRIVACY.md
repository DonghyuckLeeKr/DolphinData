# Privacy policy

DolphinData is a local-first desktop application. It does not require an account and does not include developer-operated analytics, advertising tracking, or telemetry collection.

## Data stored on the device

Plan profiles, calibration values, usage history, alert preferences, UI settings, the connected Windows network name, and a derived local network fingerprint are stored locally in the application's WebView data directory. For USB routers, the fingerprint is derived from the Windows USB device ID and gateway address; for other connections, the gateway MAC address may be used. The raw USB device ID and gateway MAC address are not persisted. Exported configuration and CSV files are created only when the user requests them.

Network adapter counters and process CPU/memory information are read from Windows and displayed locally. DolphinData does not send these measurements to the project maintainers or to a DolphinData server.

## Network connections

DolphinData can make the following network connections:

- The built-in updater checks the public GitHub Releases endpoint for a newer signed release. GitHub receives the ordinary connection metadata associated with an HTTPS request, such as the source IP address and user agent.
- Router detection can contact common private gateway addresses on the local network.
- Automatic network profile selection reads Windows network and local gateway information without sending it outside the device.
- The ping tool contacts the host explicitly selected by the user.
- Links opened by the user, including release and affiliate links, are handled by the default browser and are subject to the destination site's privacy policy.

No network measurement, profile, calibration, usage-history, or process information is attached to the update request.

## Removal

The Windows installer includes an uninstaller. Users may also remove exported files and locally stored application data using normal Windows facilities.

## Contact

Privacy questions and reports may be filed through the public repository's issue tracker: https://github.com/DonghyuckLeeKr/DolphinData/issues
