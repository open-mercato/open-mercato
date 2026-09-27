// The OAuth callback reports its outcome to the return page through this query
// param. It must not be `flash`: the global <FlashMessages> host reads `?flash=`
// as the message text and would render the raw outcome ("error"/"connected") as
// a success toast (#6402).
export const OAUTH_RESULT_QUERY_PARAM = 'oauth'
