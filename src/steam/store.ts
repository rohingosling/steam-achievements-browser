//---------------------------------------------------------------------------------------------------------------------
// Project: Steam Achievement Browser
// Version: 2.0.0
// Date:    2026-08-30
// Author:  Rohin Gosling
//
// Description:
//
//   Best-effort Steam artwork adapter. The undocumented Store app-details response and AppID-addressed Library Hero
//   CDN convention stay isolated from the contractual Steam Web API adapters and degrade safely on every failure.
//
// TODO:
//
//   1. None.
//
//---------------------------------------------------------------------------------------------------------------------

import { isJsonObject } from './client';
import { validateAppId } from './achievements';

//---------------------------------------------------------------------------------------------------------------------
// Constants.
//---------------------------------------------------------------------------------------------------------------------

const DEFAULT_TIMEOUT_MILLISECONDS = 8_000;
const STEAM_LIBRARY_ASSET_URL      = 'https://cdn.cloudflare.steamstatic.com/steam/apps/';
const STEAM_STORE_APP_DETAILS_URL  = 'https://store.steampowered.com/api/appdetails';

//---------------------------------------------------------------------------------------------------------------------
// Types.
//---------------------------------------------------------------------------------------------------------------------

export interface StoreArtwork
{
    bannerUrls: string [];
    name: string | null;
}

//---------------------------------------------------------------------------------------------------------------------
// Normalization helpers.
//---------------------------------------------------------------------------------------------------------------------

//---------------------------------------------------------------------------------------------------------------------
// Function: normalizeOptionalText
//
// Description:
//
//   Normalizes optional text into the application contract.
//
// Parameters:
//
// - value (unknown):
//   The untrusted value to validate or normalize.
//
// Returns:
//
//   The resulting string | null value.
//
//---------------------------------------------------------------------------------------------------------------------

function normalizeOptionalText ( value: unknown ): string | null
{
    if ( typeof value !== 'string' )
    {
        return null;
    }

    const normalizedValue = value.trim ();

    return normalizedValue.length > 0 ? normalizedValue : null;
}

//---------------------------------------------------------------------------------------------------------------------
// Function: normalizeImageUrl
//
// Description:
//
//   Normalizes image URL into the application contract.
//
// Parameters:
//
// - value (unknown):
//   The untrusted value to validate or normalize.
//
// Returns:
//
//   The resulting string | null value.
//
//---------------------------------------------------------------------------------------------------------------------

function normalizeImageUrl ( value: unknown ): string | null
{
    const normalizedValue = normalizeOptionalText ( value );

    if ( normalizedValue === null )
    {
        return null;
    }

    try
    {
        const url = new URL ( normalizedValue );

        return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString () : null;
    }
    catch
    {
        return null;
    }
}

//---------------------------------------------------------------------------------------------------------------------
// Function: normalizeStoreArtwork
//
// Description:
//
//   Normalizes store artwork into the application contract.
//
// Parameters:
//
// - value (unknown):
//   The untrusted value to validate or normalize.
//
// - appId (number):
//   The positive Steam AppID identifying the selected game.
//
// Returns:
//
//   The resulting StoreArtwork | null value.
//
//---------------------------------------------------------------------------------------------------------------------

function normalizeStoreArtwork ( value: unknown, appId: number ): StoreArtwork | null
{
    if ( !isJsonObject ( value ) )
    {
        return null;
    }

    const appDetails = value [ String ( appId ) ];

    if ( !isJsonObject ( appDetails ) || appDetails.success !== true || !isJsonObject ( appDetails.data ) )
    {
        return null;
    }

    const data       = appDetails.data;
    const bannerUrls = [ data.header_image, data.capsule_image, data.capsule_imagev5 ]
        .map ( normalizeImageUrl )
        .filter ( ( imageUrl ): imageUrl is string => imageUrl !== null );

    return (
        {
            bannerUrls: [ ...new Set ( bannerUrls ) ],
            name: normalizeOptionalText ( data.name ),
        }
    );
}

//---------------------------------------------------------------------------------------------------------------------
// Function: createLibraryHeroUrl
//
// Description:
//
//   Creates library hero URL from the supplied inputs.
//
// Parameters:
//
// - appId (number):
//   The positive Steam AppID identifying the selected game.
//
// Returns:
//
//   The resulting string value.
//
//---------------------------------------------------------------------------------------------------------------------

export function createLibraryHeroUrl ( appId: number ): string
{
    validateAppId ( appId );

    return new URL ( `${appId}/library_hero.jpg`, STEAM_LIBRARY_ASSET_URL ).toString ();
}

//---------------------------------------------------------------------------------------------------------------------
// Function: createLibraryLogoUrls
//
// Description:
//
//   Creates library logo urls from the supplied inputs.
//
// Parameters:
//
// - appId (number):
//   The positive Steam AppID identifying the selected game.
//
// Returns:
//
//   The resulting string [] value.
//
//---------------------------------------------------------------------------------------------------------------------

export function createLibraryLogoUrls ( appId: number ): string []
{
    validateAppId ( appId );

    return [
        new URL ( `${appId}/logo_2x.png`, STEAM_LIBRARY_ASSET_URL ).toString (),
        new URL ( `${appId}/logo.png`, STEAM_LIBRARY_ASSET_URL ).toString (),
    ];
}

//---------------------------------------------------------------------------------------------------------------------
// Store adapter.
//---------------------------------------------------------------------------------------------------------------------

//---------------------------------------------------------------------------------------------------------------------
// Function: getStoreArtwork
//
// Description:
//
//   Retrieves store artwork through the appropriate application boundary.
//
// Parameters:
//
// - appId (number):
//   The positive Steam AppID identifying the selected game.
//
// - fetchFunction (typeof fetch):
//   The injectable Fetch implementation used for the request.
//
// - timeoutMilliseconds (number):
//   The maximum time allowed for the operation in milliseconds.
//
// Returns:
//
//   The resulting Promise<StoreArtwork | null> value.
//
//---------------------------------------------------------------------------------------------------------------------

export async function getStoreArtwork
(
    appId: number,
    fetchFunction: typeof fetch = fetch,
    timeoutMilliseconds = DEFAULT_TIMEOUT_MILLISECONDS,
): Promise<StoreArtwork | null>
{
    validateAppId ( appId );

    if ( !Number.isFinite ( timeoutMilliseconds ) || timeoutMilliseconds <= 0 )
    {
        throw new RangeError ( 'A positive Store request timeout is required.' );
    }

    const url = new URL ( STEAM_STORE_APP_DETAILS_URL );

    url.searchParams.set ( 'appids', String ( appId ) );
    url.searchParams.set ( 'cc', 'us' );
    url.searchParams.set ( 'l', 'english' );

    const abortController = new AbortController ();
    const timeoutHandle   = setTimeout ( () => abortController.abort (), timeoutMilliseconds );

    try
    {
        const response = await fetchFunction (
            url,
            {
                headers:
                {
                    accept: 'application/json',
                },
                method: 'GET',
                signal: abortController.signal,
            },
        );

        if ( !response.ok )
        {
            return null;
        }

        const responseValue = JSON.parse ( await response.text () ) as unknown;

        return normalizeStoreArtwork ( responseValue, appId );
    }
    catch
    {
        return null;
    }
    finally
    {
        clearTimeout ( timeoutHandle );
    }
}
