// Simplified LLM service for POC
import Anthropic from '@anthropic-ai/sdk';

export interface TableAnalysisRequest {
    headers: string[];
    sampleRows: any[][];
    sheetName: string;
}

export interface ColumnMapping {
    originalName: string;
    mappedName: string | null;
    dataType: 'string' | 'number' | 'date' | 'boolean';
    dateFormat?: string;
    confidence: number;
}

export interface ShipmentExtractionResponse {
    containerNumber?: string | null;
    bookingNumber?: string | null;
    bolNumber?: string | null;
    carrier?: string | null;
    originPort?: string | null;
    originLocation?: string | null;
    destinationPort?: string | null;
    destinationLocation?: string | null;
    etd?: string | null;
    atd?: string | null;
    eta?: string | null;
    ata?: string | null;
    vesselName?: string | null;
    voyageNumber?: string | null;
    containerType?: string | null;
    weight?: number | null;
    volume?: number | null;
}


export interface TableAnalysisResponse {
    columns: ColumnMapping[];
}

export interface CarrierMappingResponse {
    mappings: Record<string, string>;
}

export interface StatusMappingResponse {
    mappings: Record<string, string>;
}

export class LlmService {
    private anthropic: Anthropic;

    constructor(apiKey: string) {
        this.anthropic = new Anthropic({ apiKey });
    }

    async analyzeTableStructure(request: TableAnalysisRequest): Promise<TableAnalysisResponse> {
        const prompt = `Analyze this Excel table and map columns to simplified container shipment fields.

Headers: ${JSON.stringify(request.headers)}
Sample Data (first 20 rows):
${request.sampleRows.slice(0, 20).map((row, i) => `Row ${i + 1}: ${JSON.stringify(row)}`).join('\n')}

Map to these fields (use exact names, or null if not applicable):
- internalReference: Internal tracking reference
- clientName: Client/customer name
- order: Purchase order number
- bookingNumber: Carrier booking reference
- containerNumber: Container ID
- originLocation: Port of loading
- destinationLocation: Port of discharge
- etd: Estimated time of departure
- atd: Actual time of departure
- eta: Estimated time of arrival
- ata: Actual time of arrival
- status: Shipment status
- containerType: 20FT, 40FT, 40FT_HC, 45FT
- carrier: Shipping line

Return JSON only:
{
  "columns": [
    {
      "originalName": "exact_excel_header",
      "mappedName": "exact_field_name_or_null",
      "dataType": "string",
      "dateFormat": "format_or_null",
      "confidence": 0.95
    }
  ]
}`;

        const message = await this.anthropic.messages.create({
            model: 'claude-sonnet-4-5',
            max_tokens: 20000,
            messages: [{ role: 'user', content: prompt }],
        });

        const content = message.content[0];
        if (content.type !== 'text') throw new Error('Unexpected response type');

        const jsonMatch = content.text.match(/\{[\s\S]*\}/);
        if (!jsonMatch) throw new Error('No JSON found in response');

        const parsed = JSON.parse(jsonMatch[0]);
        return { columns: parsed.columns || [] };
    }

    async detectCarrierMappings(uniqueCarriers: string[]): Promise<CarrierMappingResponse> {
        const prompt = `Map carrier names to standard names.

Detected: ${uniqueCarriers.map(c => `"${c}"`).join(', ')}

Standard: Maersk, MSC, CMA CGM, Hapag-Lloyd, OOCL, COSCO, Evergreen, Yang Ming, ONE, ZIM

Common aliases:
- MSK, MAERSK → Maersk
- CMACGM → CMA CGM
- HAPAG → Hapag-Lloyd

Return JSON: {"mappings": {"detected": "standard"}}`;

        const message = await this.anthropic.messages.create({
            model: 'claude-sonnet-4-20250514',
            max_tokens: 20000,
            messages: [{ role: 'user', content: prompt }],
        });

        const content = message.content[0];
        if (content.type !== 'text') throw new Error('Unexpected response type');

        const jsonMatch = content.text.match(/\{[\s\S]*\}/);
        if (!jsonMatch) throw new Error('No JSON found');

        return JSON.parse(jsonMatch[0]);
    }

    async mapStatusToEnum(statuses: string[]): Promise<{ mappings: Record<string, string> }> {
        const validStatuses = [
            'ORDERED',
            'BOOKED',
            'LOADING',
            'DEPARTED',
            'TRANSSHIPMENT',
            'PRE_ARRIVAL',
            'IN_PORT',
            'DELIVERED'
        ];

        const prompt = `Map these shipment status values to the closest matching enum value.
    
    Valid enum values:
    - ORDERED: Order placed but not yet booked
    - BOOKED: Booking confirmed with carrier
    - LOADING: Container being loaded
    - DEPARTED: Vessel has departed from origin port
    - TRANSSHIPMENT: In transit via transshipment port
    - PRE_ARRIVAL: Approaching destination port
    - IN_PORT: Arrived at destination port
    - DELIVERED: Cargo delivered to final destination
    
    Status values to map: ${JSON.stringify(statuses)}
    
    Common mappings:
    - "In Transit", "Sailing", "At Sea" → DEPARTED
    - "Arrived", "Discharged", "At Port" → IN_PORT
    - "On Water" → DEPARTED or TRANSSHIPMENT depending on context
    - "Completed", "Delivered", "Released" → DELIVERED
    
    Return JSON: { "mappings": { "original": "ENUM_VALUE" } }`;

        const response = await this.anthropic.messages.create({
            model: 'claude-sonnet-4-20250514',
            max_tokens: 1000,
            messages: [{ role: 'user', content: prompt }]
        });

        const text = response.content[0].type === 'text' ? response.content[0].text : '';
        const json = JSON.parse(text.replace(/```json\n?/g, '').replace(/```\n?/g, ''));

        return json;
    }

    async extractShipmentData(pdfBase64: string): Promise<ShipmentExtractionResponse> {
        const prompt = `Extract shipment information from this document. Return ONLY a JSON object with the following fields (use null for missing values):
    
    {
      "containerNumber": "string",
      "bookingNumber": "string",
      "bolNumber": "string",
      "carrier": "string",
      "originPort": "string",
      "originLocation": "string",
      "destinationPort": "string",
      "destinationLocation": "string",
      "etd": "ISO date string or null",
      "atd": "ISO date string or null",
      "eta": "ISO date string or null",
      "ata": "ISO date string or null",
      "vesselName": "string",
      "voyageNumber": "string",
      "containerType": "string (20GP, 40GP, 40HC, 45HC, etc.)",
      "weight": "number",
      "volume": "number"
    }
    
    Return only the JSON, no explanation or markdown.`;

        const message = await this.anthropic.messages.create({
            model: 'claude-sonnet-4-20250514',
            max_tokens: 4096,
            messages: [
                {
                    role: 'user',
                    content: [
                        {
                            type: 'document',
                            source: {
                                type: 'base64',
                                media_type: 'application/pdf',
                                data: pdfBase64,
                            },
                        },
                        {
                            type: 'text',
                            text: prompt,
                        },
                    ],
                },
            ],
        });

        const content = message.content[0];
        if (content.type !== 'text') throw new Error('Unexpected response type');

        // Extract JSON from response
        const jsonMatch = content.text.match(/\{[\s\S]*\}/);
        if (!jsonMatch) throw new Error('No JSON found in response');

        return JSON.parse(jsonMatch[0]);
    }

}