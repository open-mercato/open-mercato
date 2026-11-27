# Corporate proxy root CAs

Place reviewed public PEM root certificates here as *.crt or *.pem. The recovery-tools stage trusts them before apk downloads and sets NODE_EXTRA_CA_CERTS. Never store private keys here. Use ALPINE_MIRROR for an explicitly selected internal Alpine mirror. Do not commit certificates.
