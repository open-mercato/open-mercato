import { TPAY_PRODUCTION_JWS_ROOT_PEM } from './production'
import { TPAY_SANDBOX_JWS_ROOT_PEM } from './sandbox'
import type { TpayEnvironment } from '../tpay-client'

export type TpayJwsTrustConfig = {
  x5u: string
  expectedLeafCommonName: string
  anchors: string
  rootFingerprint256: string
}

export const TPAY_KIP_ROOT_CA_SHA256 =
  'E5:12:85:0C:FF:80:F7:BE:D1:1F:38:90:0D:D5:B7:AD:E0:00:37:A5:30:09:FC:B9:4E:8F:65:F1:13:E9:68:84'

export const TPAY_JWS_TRUST: Readonly<Record<TpayEnvironment, TpayJwsTrustConfig>> = {
  production: {
    x5u: 'https://secure.tpay.com/x509/notifications-jws.pem',
    expectedLeafCommonName: 'notification.tpay.com',
    anchors: TPAY_PRODUCTION_JWS_ROOT_PEM,
    rootFingerprint256: TPAY_KIP_ROOT_CA_SHA256,
  },
  sandbox: {
    x5u: 'https://secure.sandbox.tpay.com/x509/notifications-jws.pem',
    expectedLeafCommonName: 'notification.sandbox.tpay.com',
    anchors: TPAY_SANDBOX_JWS_ROOT_PEM,
    rootFingerprint256: TPAY_KIP_ROOT_CA_SHA256,
  },
}
