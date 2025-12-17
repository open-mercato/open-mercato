import { EntityManager } from "@mikro-orm/core";
import { loadFreighttechTrackingSettings } from "./settings";
import { encodeWebhookToken } from "../lib/webhookToken";

async function fetchFreighttech(
    path: string,
    config: {
        em: EntityManager
        organizationId: string
        tenantId: string
        method: string,
        body?: any
    },
) {
    const settings = await loadFreighttechTrackingSettings(config.em, { organizationId: config.organizationId, tenantId: config.tenantId })
    if (!settings?.apiBaseUrl || !settings?.apiKey) {
        throw Error(`[freighttech_tracking.api] missing apiKey and/or apiBaseUrl`)
    }

    console.debug(`[freighttech_tracking.api] external API call`, {baseUrl: settings.apiBaseUrl, path})
    const response = await fetch(`${settings.apiBaseUrl}${path}`, {
        method: config.method,
        headers: {
            'X-Api-Key': settings.apiKey,
            'Content-Type': 'application/json'
        },
        body: config.body ? JSON.stringify(config.body) : undefined,
        signal: AbortSignal.timeout(5000)
    });

    if (!response.ok) {
        const errData = await response.json();
        console.warn(`[freighttech_tracking.api] external API call: ${response.status} ${response.statusText}`, { error: errData })

        throw new Error(`freighttech_tracking.api] HTTP error! status: ${response.status}`);
    }

    return response.json();
}

type ContainerSubscriptionParams = {
    organizationId: string;
    tenantId: string;
    bookingNumber?: string;
    containerId?: string;
    carrierCode: string;
}

// RegisterContainerSubscription initializes container tracking using a webhook
export async function RegisterContainerSubscription(
    em: EntityManager,
    { organizationId, tenantId, carrierCode, bookingNumber, containerId }: ContainerSubscriptionParams,
) {
    if (!process.env.APP_URL) {
        throw new Error(`freighttech_tracking.api] missing APP_URL`);
    }

    const data = await fetchFreighttech('/v1/references', {
        method: 'POST',
        em,
        organizationId,
        tenantId,
        body: {
            carrier_code: carrierCode,
            booking_number: bookingNumber,
            container_id: containerId,
            callback_url: `${process.env.APP_URL}/api/freighttech_tracking/webhook?token=${encodeWebhookToken({ organizationId, tenantId })}`,
        }
    })

    return data as ReferenceResponse;
}

interface Organization {
    id: string;
    name: string;
    active: boolean;
    process_frequency_minutes: number;
    created_at: string;
    updated_at: string;
}

interface Carrier {
    id: string;
    name: string;
    code: string;
    enabled: boolean;
    created_at: string;
    updated_at: string;
}

interface Reference {
    id: string;
    container_id: string;
    booking_number: string | null;
    bill_of_lading: string | null;
    carrier_code: string;
    carrier_id?: string;
    callback_url: string;
    organization_id: string;
    parent_reference_id: string | null;
    latest_update_id: string;
    active: boolean;
    auto_unsubscribed: boolean; // 
    deactivate_reason: string;
    last_update_status: string;
    created_at: string;
    updated_at: string;
    last_update_attempted_at: string;
    retry_count: number;
    organization: Organization;
    carrier: Carrier;
}

interface ReferenceResponse {
    message: string;
    reference: Reference;
}
