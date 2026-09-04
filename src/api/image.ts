//---------------------------------------------------------------------------------------------------------------------
// Project: Steam Achievement Browser
// Version: 2.0.0
// Date:    2026-09-03
// Author:  Rohin Gosling
//
// Description:
//
//   Retrieves only allow-listed Steam-hosted raster images for same-origin screenshot composition. Buffering enforces
//   a strict response-size ceiling before untrusted bytes are returned to the browser. Redirect destinations are
//   revalidated so an allowed hostname cannot relay the Worker to an unapproved destination.
//---------------------------------------------------------------------------------------------------------------------

const IMAGE_CACHE_CONTROL          = 'private, max-age=300';
const IMAGE_FETCH_TIMEOUT          = 10_000;
const LEGACY_COMMUNITY_APP_PATH    = '/steamcommunity/public/images/apps/';
const LEGACY_STORE_ITEM_APP_PATH   = '/steam/apps/';
const MAXIMUM_IMAGE_BYTE_LENGTH    = 10 * 1024 * 1024;
const MAXIMUM_IMAGE_REDIRECTS      = 5;
const MODERN_COMMUNITY_APP_PATH    = '/community_assets/images/apps/';
const MODERN_STORE_ITEM_APP_PATH   = '/store_item_assets/steam/apps/';
const STEAM_AKAMAI_HOSTNAME        = 'steamcdn-a.akamaihd.net';
const STEAM_CDN_FASTLY_HOSTNAME    = 'cdn.fastly.steamstatic.com';
const STEAM_SHARED_FASTLY_HOSTNAME = 'shared.fastly.steamstatic.com';
const STEAM_MEDIA_HOSTNAME         = 'media.steampowered.com';
const STEAM_STATIC_SUFFIX          = '.steamstatic.com';

const PREFERRED_STEAM_IMAGE_HOSTNAMES = new Map
(
    [
        [ 'avatars.akamai.steamstatic.com',     'avatars.fastly.steamstatic.com' ],
        [ 'avatars.cloudflare.steamstatic.com', 'avatars.fastly.steamstatic.com' ],
        [ 'avatars.steamstatic.com',            'avatars.fastly.steamstatic.com' ],
        [ 'cdn.akamai.steamstatic.com',         STEAM_CDN_FASTLY_HOSTNAME ],
        [ 'cdn.cloudflare.steamstatic.com',     STEAM_CDN_FASTLY_HOSTNAME ],
        [ STEAM_AKAMAI_HOSTNAME,                STEAM_CDN_FASTLY_HOSTNAME ],
        [ STEAM_MEDIA_HOSTNAME,                 STEAM_CDN_FASTLY_HOSTNAME ],
        [ 'shared.akamai.steamstatic.com',      STEAM_SHARED_FASTLY_HOSTNAME ],
        [ 'shared.cloudflare.steamstatic.com',  STEAM_SHARED_FASTLY_HOSTNAME ],
    ]
);

const ALLOWED_IMAGE_CONTENT_TYPES = new Set
(
    [
        'image/avif',
        'image/gif',
        'image/jpeg',
        'image/png',
        'image/webp',
    ]
);

//---------------------------------------------------------------------------------------------------------------------
// Class: SteamImageProxyError
//
// Description:
//
//   Represents a safe validation or upstream failure from the screenshot image boundary.
//---------------------------------------------------------------------------------------------------------------------

export class SteamImageProxyError extends Error
{
    readonly code:      string;
    readonly retryable: boolean;
    readonly status:    number;

    constructor ( code: string, message: string, status: number, retryable = false )
    {
        super ( message );

        this.code      = code;
        this.name      = 'SteamImageProxyError';
        this.retryable = retryable;
        this.status    = status;
    }
}

//---------------------------------------------------------------------------------------------------------------------
// Function: isAllowedSteamImageUrl
//
// Description:
//
//   Accepts HTTPS raster-image locations on Steam's static asset hosts only.
//
// Parameters:
//
// - imageUrl (string):
//   The candidate image URL to validate.
//
// Returns:
//
//   Whether the URL is safe for the screenshot image boundary.
//
//---------------------------------------------------------------------------------------------------------------------

export function isAllowedSteamImageUrl ( imageUrl: string ): boolean
{
    try
    {
        const url      = new URL ( imageUrl );
        const hostname = url.hostname.toLowerCase ();

        return url.protocol === 'https:'
            && url.port.length === 0
            && url.username.length === 0
            && url.password.length === 0
            && (
                hostname.endsWith ( STEAM_STATIC_SUFFIX )
                || hostname === STEAM_AKAMAI_HOSTNAME
                || hostname === STEAM_MEDIA_HOSTNAME
            );
    }
    catch
    {
        return false;
    }
}

//---------------------------------------------------------------------------------------------------------------------
// Function: createSteamImageFetchCandidates
//
// Description:
//
//   Prefers Valve's modern Fastly-backed asset paths because Steam's legacy image locations can reject uncached
//   requests originating from Cloudflare Workers. The original approved URL remains a fallback if an asset is absent
//   from the equivalent modern path.
//
// Parameters:
//
// - imageUrl (string):
//   The already validated Steam image URL supplied by the browser.
//
// Returns:
//
//   The preferred and original approved image locations in request order.
//
//---------------------------------------------------------------------------------------------------------------------

export function createSteamImageFetchCandidates ( imageUrl: string ): string[]
{
    const originalUrl       = new URL ( imageUrl );
    const originalHostname  = originalUrl.hostname.toLowerCase ();
    const preferredHostname = PREFERRED_STEAM_IMAGE_HOSTNAMES.get ( originalHostname );
    const legacyCommunityPathSuffix = originalUrl.pathname.startsWith ( LEGACY_COMMUNITY_APP_PATH )
        ? originalUrl.pathname.slice ( LEGACY_COMMUNITY_APP_PATH.length )
        : null;
    const legacyStoreItemPathSuffix = originalUrl.pathname.startsWith ( LEGACY_STORE_ITEM_APP_PATH )
        ? originalUrl.pathname.slice ( LEGACY_STORE_ITEM_APP_PATH.length )
        : null;

    if ( legacyStoreItemPathSuffix !== null && /^[1-9]\d*\/[^/]+$/u.test ( legacyStoreItemPathSuffix ) )
    {
        const preferredUrl = new URL ( originalUrl.href );

        preferredUrl.hostname = STEAM_SHARED_FASTLY_HOSTNAME;
        preferredUrl.pathname = MODERN_STORE_ITEM_APP_PATH + legacyStoreItemPathSuffix;

        return [ preferredUrl.href, originalUrl.href ];
    }

    if ( legacyCommunityPathSuffix !== null && /^\d+\/[^/]+$/u.test ( legacyCommunityPathSuffix ) )
    {
        const preferredUrl = new URL ( originalUrl.href );

        preferredUrl.hostname = STEAM_SHARED_FASTLY_HOSTNAME;
        preferredUrl.pathname = MODERN_COMMUNITY_APP_PATH + legacyCommunityPathSuffix;

        return [ preferredUrl.href, originalUrl.href ];
    }

    if ( preferredHostname === undefined || preferredHostname === originalHostname )
    {
        return [ originalUrl.href ];
    }

    const preferredUrl = new URL ( originalUrl.href );

    preferredUrl.hostname = preferredHostname;

    return [ preferredUrl.href, originalUrl.href ];
}

//---------------------------------------------------------------------------------------------------------------------
// Function: fetchSteamImageCandidate
//
// Description:
//
//   Retrieves one approved Steam image candidate while validating every redirect destination before it is contacted.
//
// Parameters:
//
// - imageUrl (string):
//   The approved candidate image URL.
//
// - fetchFunction (typeof fetch):
//   The fetch implementation used for the upstream request.
//
// Returns:
//
//   The first non-redirect upstream response.
//
//---------------------------------------------------------------------------------------------------------------------

async function fetchSteamImageCandidate ( imageUrl: string, fetchFunction: typeof fetch ): Promise<Response>
{
    let currentImageUrl = imageUrl;

    for ( let redirectCount = 0; redirectCount <= MAXIMUM_IMAGE_REDIRECTS; redirectCount += 1 )
    {
        let upstreamResponse: Response;

        try
        {
            upstreamResponse = await fetchFunction (
                currentImageUrl,
                {
                    headers:
                    {
                        accept: 'image/avif,image/webp,image/png,image/jpeg,image/gif',
                    },
                    redirect: 'manual',
                    signal:   AbortSignal.timeout ( IMAGE_FETCH_TIMEOUT ),
                },
            );
        }
        catch
        {
            throw new SteamImageProxyError (
                'STEAM_IMAGE_UNAVAILABLE',
                'The requested Steam image is currently unavailable.',
                502,
                true,
            );
        }

        if ( upstreamResponse.status < 300 || upstreamResponse.status >= 400 )
        {
            return upstreamResponse;
        }

        const redirectLocation = upstreamResponse.headers.get ( 'location' );
        let redirectedImageUrl: string;

        try
        {
            redirectedImageUrl = new URL ( redirectLocation ?? '', currentImageUrl ).href;
        }
        catch
        {
            throw new SteamImageProxyError (
                'STEAM_IMAGE_UNAVAILABLE',
                'The requested Steam image is currently unavailable.',
                502,
            );
        }

        if ( redirectLocation === null || !isAllowedSteamImageUrl ( redirectedImageUrl ) )
        {
            throw new SteamImageProxyError (
                'STEAM_IMAGE_UNAVAILABLE',
                'The requested Steam image is currently unavailable.',
                502,
            );
        }

        currentImageUrl = redirectedImageUrl;
    }

    throw new SteamImageProxyError (
        'STEAM_IMAGE_UNAVAILABLE',
        'The requested Steam image is currently unavailable.',
        502,
    );
}

//---------------------------------------------------------------------------------------------------------------------
// Function: fetchAllowedSteamImage
//
// Description:
//
//   Retrieves an approved Steam image while validating every redirect destination before it is contacted.
//
// Parameters:
//
// - imageUrl (string):
//   The already validated initial Steam image URL.
//
// - fetchFunction (typeof fetch):
//   The fetch implementation used for the upstream request.
//
// Returns:
//
//   The first non-redirect upstream response.
//
//---------------------------------------------------------------------------------------------------------------------

async function fetchAllowedSteamImage ( imageUrl: string, fetchFunction: typeof fetch ): Promise<Response>
{
    const imageCandidates = createSteamImageFetchCandidates ( imageUrl );
    let lastResponse: Response | null = null;

    for ( const [ candidateIndex, imageCandidate ] of imageCandidates.entries () )
    {
        let upstreamResponse: Response;

        try
        {
            upstreamResponse = await fetchSteamImageCandidate ( imageCandidate, fetchFunction );
        }
        catch ( error )
        {
            const hasFallbackCandidate = candidateIndex < imageCandidates.length - 1;

            if (
                error instanceof SteamImageProxyError
                && error.retryable
                && hasFallbackCandidate
            )
            {
                continue;
            }

            throw error;
        }

        const contentType = upstreamResponse.headers.get ( 'content-type' )
            ?.split ( ';', 1 ) [ 0 ]?.trim ().toLowerCase ();

        if (
            upstreamResponse.ok
            && contentType !== undefined
            && ALLOWED_IMAGE_CONTENT_TYPES.has ( contentType )
        )
        {
            return upstreamResponse;
        }

        lastResponse = upstreamResponse;
    }

    if ( lastResponse !== null )
    {
        return lastResponse;
    }

    throw new SteamImageProxyError (
        'STEAM_IMAGE_UNAVAILABLE',
        'The requested Steam image is currently unavailable.',
        502,
    );
}

//---------------------------------------------------------------------------------------------------------------------
// Function: retrieveSteamImage
//
// Description:
//
//   Retrieves and validates one allow-listed Steam raster image for same-origin screenshot composition.
//
// Parameters:
//
// - imageUrl (string):
//   The Steam-hosted image URL requested by the browser.
//
// - fetchFunction (typeof fetch):
//   The fetch implementation used for the upstream request.
//
// Returns:
//
//   A safe same-origin raster response.
//
//---------------------------------------------------------------------------------------------------------------------

export async function retrieveSteamImage
(
    imageUrl: string,
    fetchFunction: typeof fetch = fetch,
): Promise<Response>
{
    if ( !isAllowedSteamImageUrl ( imageUrl ) )
    {
        throw new SteamImageProxyError (
            'STEAM_IMAGE_INVALID',
            'The requested Steam image URL is not supported.',
            400,
        );
    }

    const upstreamResponse = await fetchAllowedSteamImage ( imageUrl, fetchFunction );
    const contentType      = upstreamResponse.headers.get ( 'content-type' )
        ?.split ( ';', 1 ) [ 0 ]?.trim ().toLowerCase ();

    if ( !upstreamResponse.ok || contentType === undefined || !ALLOWED_IMAGE_CONTENT_TYPES.has ( contentType ) )
    {
        throw new SteamImageProxyError (
            'STEAM_IMAGE_UNAVAILABLE',
            'The requested Steam image is currently unavailable.',
            502,
        );
    }

    const declaredByteLength = Number ( upstreamResponse.headers.get ( 'content-length' ) );

    if ( Number.isFinite ( declaredByteLength ) && declaredByteLength > MAXIMUM_IMAGE_BYTE_LENGTH )
    {
        throw new SteamImageProxyError (
            'STEAM_IMAGE_TOO_LARGE',
            'The requested Steam image is too large to export.',
            413,
        );
    }

    const imageBytes = await upstreamResponse.arrayBuffer ();

    if ( imageBytes.byteLength > MAXIMUM_IMAGE_BYTE_LENGTH )
    {
        throw new SteamImageProxyError (
            'STEAM_IMAGE_TOO_LARGE',
            'The requested Steam image is too large to export.',
            413,
        );
    }

    return new Response (
        imageBytes,
        {
            headers:
            {
                'cache-control':          IMAGE_CACHE_CONTROL,
                'content-type':           contentType,
                'x-content-type-options': 'nosniff',
            },
            status: 200,
        },
    );
}
