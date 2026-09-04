//---------------------------------------------------------------------------------------------------------------------
// Project: Steam Achievement Browser
// Version: 2.0.0
// Date:    2026-08-30
// Author:  Rohin Gosling
//
// Description:
//
//   Unit tests for English achievement-schema retrieval and normalized shared definition mapping.
//
// TODO:
//
//   1. None.
//
//---------------------------------------------------------------------------------------------------------------------

import { describe, expect, it, vi } from 'vitest';

import {
    getAchievementItemProgressSchema,
    getAchievementSchema,
    getGlobalAchievementRarity,
    getPlayerAchievementItemProgress,
    getPlayerAchievements,
    normalizeAchievementItemProgressSchema,
    normalizeAchievementSchema,
    normalizeGlobalAchievementRarity,
    normalizePlayerAchievementItemProgressStates,
    normalizePlayerAchievementStates,
} from '../src/steam/achievements';
import { SteamGameDetailsPrivateError } from '../src/steam/library';

describe ( 'Steam achievement-schema adapter', () =>
{
    it ( 'requests the English schema and retains only normalized achievement definitions', async () =>
    {
        const fetchFunction = vi.fn ( async ( _input: RequestInfo | URL ) => Response.json (
            {
                game:
                {
                    availableGameStats:
                    {
                        achievements:
                        [
                            {
                                description: 'Complete the test.',
                                displayName: 'Test Achievement',
                                icon:        'https://cdn.example/unlocked.jpg',
                                icongray:    'https://cdn.example/locked.jpg',
                                name:        'TEST_ACHIEVEMENT',
                            },
                        ],
                    },
                },
            },
        ) );
        const schema = await getAchievementSchema ( 620, 'test-api-key', fetchFunction );
        const url    = fetchFunction.mock.calls [ 0 ]?.[ 0 ];

        expect ( schema ).toEqual (
            {
                achievements:
                [
                    {
                        apiName:     'TEST_ACHIEVEMENT',
                        description: 'Complete the test.',
                        iconGrayUrl: 'https://cdn.example/locked.jpg',
                        iconUrl:     'https://cdn.example/unlocked.jpg',
                        name:        'Test Achievement',
                    },
                ],
            },
        );
        expect ( url ).toBeInstanceOf ( URL );

        if ( ! ( url instanceof URL ) )
        {
            throw new TypeError ( 'Expected the Steam adapter to call fetch with a URL.' );
        }

        expect ( url.pathname ).toBe ( '/ISteamUserStats/GetSchemaForGame/v2/' );
        expect ( url.searchParams.get ( 'appid' ) ).toBe ( '620' );
        expect ( url.searchParams.get ( 'l' ) ).toBe ( 'english' );
    } );

    it ( 'treats a missing achievement collection as a valid zero-achievement schema', async () =>
    {
        const fetchFunction = vi.fn ( async () => Response.json ( { game: {} } ) );

        await expect ( getAchievementSchema ( 620, 'test-api-key', fetchFunction ) ).resolves.toEqual (
            { achievements: [] },
        );
    } );

    it ( 'filters malformed and duplicate definitions deterministically', () =>
    {
        expect ( normalizeAchievementSchema (
            [
                { displayName: '', name: 'VALID' },
                { displayName: 'Duplicate', name: 'VALID' },
                { displayName: 'Missing API name' },
                null,
            ],
        ) ).toEqual (
            {
                achievements:
                [
                    {
                        apiName:     'VALID',
                        description: null,
                        iconGrayUrl: null,
                        iconUrl:     null,
                        name:        'VALID',
                    },
                ],
            },
        );
    } );

    it ( 'rejects an invalid AppID without contacting Steam', async () =>
    {
        const fetchFunction = vi.fn ();

        await expect ( getAchievementSchema ( 0, 'test-api-key', fetchFunction ) ).rejects.toBeInstanceOf ( RangeError );
        expect ( fetchFunction ).not.toHaveBeenCalled ();
    } );
} );

describe ( 'Steam item-progress adapters', () =>
{
    it ( 'normalizes accumulative definitions from the richer game-achievement service', async () =>
    {
        const fetchFunction = vi.fn ( async ( _input: RequestInfo | URL ) => Response.json (
            {
                response:
                {
                    achievements:
                    [
                        {
                            internal_key:    9728,
                            internal_name:   'ACCUMULATIVE',
                            max_progress_int: 10,
                            min_progress_int: 0,
                            progress_type:    1,
                        },
                        {
                            internal_key:    9729,
                            internal_name:   'SINGLE_EVENT',
                            max_progress_int: 1,
                            min_progress_int: 0,
                            progress_type:    1,
                        },
                    ],
                },
            },
        ) );
        const schema = await getAchievementItemProgressSchema ( 578080, 'test-api-key', fetchFunction );
        const url    = fetchFunction.mock.calls [ 0 ]?.[ 0 ];

        expect ( schema ).toEqual (
            {
                achievements:
                [
                    {
                        apiName:     'ACCUMULATIVE',
                        internalKey: 9728,
                        minimum:     0,
                        target:      10,
                    },
                ],
            },
        );
        expect ( url ).toBeInstanceOf ( URL );

        if ( ! ( url instanceof URL ) )
        {
            throw new TypeError ( 'Expected the Steam adapter to call fetch with a URL.' );
        }

        expect ( url.pathname ).toBe ( '/IPlayerService/GetGameAchievements/v1/' );
        expect ( JSON.parse ( url.searchParams.get ( 'input_json' ) ?? '' ) ).toEqual (
            {
                appid:     578080,
                hash_only: false,
                language:  'english',
            },
        );
    } );

    it ( 'normalizes integer and floating-point user progress by internal key', async () =>
    {
        const fetchFunction = vi.fn ( async () => Response.json (
            {
                response:
                {
                    achievements:
                    [
                        { internal_key: 9728, progress_int: 7 },
                        { internal_key: 9729, progress_float: 2.5 },
                        { internal_key: 9730, unlocked: true },
                    ],
                },
            },
        ) );
        const states = await getPlayerAchievementItemProgress (
            '76561198000000000',
            578080,
            'test-api-key',
            fetchFunction,
        );

        expect ( states ).toEqual (
            [
                { current: 7, internalKey: 9728 },
                { current: 2.5, internalKey: 9729 },
            ],
        );
    } );

    it ( 'filters malformed, duplicate, and single-event progress records', () =>
    {
        expect ( normalizeAchievementItemProgressSchema (
            [
                { internal_key: 1, internal_name: 'VALID', max_progress_int: 10, progress_type: 1 },
                { internal_key: 2, internal_name: 'VALID', max_progress_int: 20, progress_type: 1 },
                { internal_key: 3, internal_name: 'SINGLE', max_progress_int: 1, progress_type: 1 },
                { internal_key: 4, internal_name: 'MISSING_TARGET', progress_type: 1 },
            ],
        ).achievements ).toEqual (
            [ { apiName: 'VALID', internalKey: 1, minimum: 0, target: 10 } ],
        );
        expect ( normalizePlayerAchievementItemProgressStates (
            [
                { internal_key: 1, progress_int: 4 },
                { internal_key: 1, progress_int: 8 },
                { internal_key: 2 },
            ],
        ) ).toEqual ( [ { current: 4, internalKey: 1 } ] );
    } );
} );

describe ( 'Steam player-achievement adapter', () =>
{
    it ( 'requests English player state and normalizes unlocked and locked records', async () =>
    {
        const fetchFunction = vi.fn ( async ( _input: RequestInfo | URL ) => Response.json (
            {
                playerstats:
                {
                    achievements:
                    [
                        { achieved: 1, apiname: 'UNLOCKED', unlocktime: 1_780_000_000 },
                        { achieved: 0, apiname: 'LOCKED', unlocktime: 0 },
                    ],
                    success: true,
                },
            },
        ) );
        const states = await getPlayerAchievements (
            '76561198000000000',
            620,
            'test-api-key',
            fetchFunction,
        );
        const url = fetchFunction.mock.calls [ 0 ]?.[ 0 ];

        expect ( states ).toEqual (
            [
                { achieved: true, apiName: 'UNLOCKED', unlockTime: 1_780_000_000 },
                { achieved: false, apiName: 'LOCKED', unlockTime: null },
            ],
        );
        expect ( url ).toBeInstanceOf ( URL );

        if ( ! ( url instanceof URL ) )
        {
            throw new TypeError ( 'Expected the Steam adapter to call fetch with a URL.' );
        }

        expect ( url.pathname ).toBe ( '/ISteamUserStats/GetPlayerAchievements/v1/' );
        expect ( url.searchParams.get ( 'appid' ) ).toBe ( '620' );
        expect ( url.searchParams.get ( 'l' ) ).toBe ( 'english' );
        expect ( url.searchParams.get ( 'steamid' ) ).toBe ( '76561198000000000' );
    } );

    it ( 'filters malformed and duplicate player states deterministically', () =>
    {
        expect ( normalizePlayerAchievementStates (
            [
                { achieved: 1, apiname: 'VALID', unlocktime: 100 },
                { achieved: 0, apiname: 'VALID', unlocktime: 0 },
                { achieved: 2, apiname: 'INVALID_STATE', unlocktime: 100 },
                { achieved: 1, unlocktime: 100 },
            ],
        ) ).toEqual ( [ { achieved: true, apiName: 'VALID', unlockTime: 100 } ] );
    } );

    it ( 'maps an explicitly unsuccessful player response to the expected privacy state', async () =>
    {
        const fetchFunction = vi.fn ( async () => Response.json ( { playerstats: { success: false } } ) );

        await expect ( getPlayerAchievements (
            '76561198000000000',
            620,
            'test-api-key',
            fetchFunction,
        ) ).rejects.toBeInstanceOf ( SteamGameDetailsPrivateError );
    } );

    it.each ( [ 401, 403 ] ) ( 'maps a Steam %s player-achievement rejection to privacy', async upstreamStatus =>
    {
        const fetchFunction = vi.fn (
            async () => new Response ( 'private upstream body', { status: upstreamStatus } ),
        );

        await expect ( getPlayerAchievements (
            '76561198000000000',
            620,
            'test-api-key',
            fetchFunction,
        ) ).rejects.toBeInstanceOf ( SteamGameDetailsPrivateError );
    } );
} );

describe ( 'Steam global-rarity adapter', () =>
{
    it ( 'requests and normalizes global achievement percentages', async () =>
    {
        const fetchFunction = vi.fn ( async ( _input: RequestInfo | URL ) => Response.json (
            {
                achievementpercentages:
                {
                    achievements:
                    [
                        { name: 'RARE', percent: '4.25' },
                        { name: 'COMMON', percent: '92.5' },
                    ],
                },
            },
        ) );
        const rarity = await getGlobalAchievementRarity ( 620, 'test-api-key', fetchFunction );
        const url    = fetchFunction.mock.calls [ 0 ]?.[ 0 ];

        expect ( rarity ).toEqual (
            {
                achievements:
                [
                    { apiName: 'RARE', globalPercentage: 4.25 },
                    { apiName: 'COMMON', globalPercentage: 92.5 },
                ],
            },
        );
        expect ( url ).toBeInstanceOf ( URL );

        if ( ! ( url instanceof URL ) )
        {
            throw new TypeError ( 'Expected the Steam adapter to call fetch with a URL.' );
        }

        expect ( url.pathname ).toBe ( '/ISteamUserStats/GetGlobalAchievementPercentagesForApp/v2/' );
        expect ( url.searchParams.get ( 'gameid' ) ).toBe ( '620' );
    } );

    it ( 'filters invalid percentages and keeps the first duplicate', () =>
    {
        expect ( normalizeGlobalAchievementRarity (
            [
                { name: 'VALID', percent: '0' },
                { name: 'VALID', percent: '50' },
                { name: 'DECIMAL_STRING', percent: '64.7' },
                { name: 'NUMBER', percent: 12.5 },
                { name: 'TOO_HIGH', percent: '101' },
                { name: 'NEGATIVE', percent: '-1' },
                { name: 'NOT_NUMERIC', percent: 'not-a-number' },
                { name: 'EMPTY', percent: ' ' },
                { name: 'HEX', percent: '0x10' },
            ],
        ) ).toEqual (
            {
                achievements:
                [
                    { apiName: 'VALID', globalPercentage: 0 },
                    { apiName: 'DECIMAL_STRING', globalPercentage: 64.7 },
                    { apiName: 'NUMBER', globalPercentage: 12.5 },
                ],
            },
        );
    } );
} );
