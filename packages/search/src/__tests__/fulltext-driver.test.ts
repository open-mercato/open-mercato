const mockSearch = jest.fn();
const mockAddDocuments = jest.fn();
const mockUpdateSettings = jest.fn();
const mockCreateIndex = jest.fn();
const mockHealth = jest.fn();
const mockDeleteIndex = jest.fn();
const mockDeleteDocument = jest.fn();
const mockDeleteDocuments = jest.fn();
const mockDeleteAllDocuments = jest.fn();
const mockGetStats = jest.fn();
const mockGetDocuments = jest.fn();
const meiliSearchConstructor = jest.fn();

jest.mock('meilisearch', () => ({
  MeiliSearch: jest.fn((...args) => meiliSearchConstructor(...args)),
}));

import { createMeilisearchDriver } from '../fulltext/drivers/meilisearch';

describe('createMeilisearchDriver', () => {
  beforeEach(() => {
    mockSearch.mockReset().mockResolvedValue({ hits: [] });
    mockAddDocuments.mockReset().mockResolvedValue(undefined);
    mockUpdateSettings.mockReset().mockResolvedValue(undefined);
    mockCreateIndex.mockReset().mockResolvedValue(undefined);
    mockHealth.mockReset().mockResolvedValue({ status: 'available' });
    mockDeleteIndex.mockReset().mockResolvedValue(undefined);
    mockDeleteDocument.mockReset().mockResolvedValue(undefined);
    mockDeleteDocuments.mockReset().mockResolvedValue(undefined);
    mockDeleteAllDocuments.mockReset().mockResolvedValue(undefined);
    mockGetStats.mockReset().mockResolvedValue({
      numberOfDocuments: 0,
      isIndexing: false,
      fieldDistribution: {},
    });
    mockGetDocuments.mockReset().mockResolvedValue({ results: [] });
    meiliSearchConstructor.mockReset().mockReturnValue({
      createIndex: mockCreateIndex,
      health: mockHealth,
      deleteIndex: mockDeleteIndex,
      index: jest.fn(() => ({
        updateSettings: mockUpdateSettings,
        search: mockSearch,
        addDocuments: mockAddDocuments,
        deleteDocument: mockDeleteDocument,
        deleteDocuments: mockDeleteDocuments,
        deleteAllDocuments: mockDeleteAllDocuments,
        getStats: mockGetStats,
        getDocuments: mockGetDocuments,
      })),
    });
  });

  it('indexes only safe searchable fields from field policy', async () => {
    const driver = createMeilisearchDriver({
      host: 'http://search.test',
      apiKey: 'test-key',
      fieldPolicyResolver: () => ({
        searchable: ['first_name', 'last_name', 'job_title'],
        hashOnly: ['primary_email'],
        excluded: ['government_id'],
      }),
    });

    await driver.index({
      recordId: 'person-1',
      entityId: 'customers:customer_person_profile',
      tenantId: 'tenant-1',
      fields: {
        first_name: 'Ada',
        last_name: 'Lovelace',
        job_title: 'Engineer',
        primary_email: 'ada@example.com',
        government_id: 'secret-token',
      },
      presenter: {
        title: 'Ada Lovelace',
        subtitle: 'Engineer · ada@example.com',
        icon: 'user',
      },
    });

    expect(mockAddDocuments).toHaveBeenCalledTimes(1);
    const indexedDocument = mockAddDocuments.mock.calls[0]?.[0]?.[0] as Record<string, unknown>;
    expect(indexedDocument).toMatchObject({
      _id: 'person-1',
      _entityId: 'customers:customer_person_profile',
      _presenter: {
        title: 'Ada Lovelace',
        subtitle: 'Engineer · ada@example.com',
        icon: 'user',
      },
      first_name: 'Ada',
      last_name: 'Lovelace',
      job_title: 'Engineer',
    });
    expect(indexedDocument.primary_email).toBeUndefined();
    expect(indexedDocument.government_id).toBeUndefined();
  });

  it('restricts fulltext queries to safe searchable attributes', async () => {
    const driver = createMeilisearchDriver({
      host: 'http://search.test',
      apiKey: 'test-key',
      searchableAttributesResolver: () => ['first_name', 'last_name', 'job_title'],
    });

    await driver.search('ada@example.com', {
      tenantId: 'tenant-1',
      entityTypes: ['customers:customer_person_profile'],
      limit: 10,
    });

    expect(mockSearch).toHaveBeenCalledWith(
      'ada@example.com',
      expect.objectContaining({
        limit: 10,
        showRankingScore: true,
        attributesToSearchOn: ['first_name', 'last_name', 'job_title'],
      }),
    );
  });
});
