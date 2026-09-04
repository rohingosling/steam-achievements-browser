//---------------------------------------------------------------------------------------------------------------------
// Project: Steam Achievement Browser
// Version: 2.0.0
// Date:    2026-08-29
// Author:  Rohin Gosling
//
// Description:
//
//   Server-only Steam Web API client. URL construction, authentication, timeouts, response parsing, validation, and
//   safe upstream error normalization are centralized here so feature adapters never expose Steam credentials or raw
//   upstream diagnostics.
//
// TODO:
//
//   1. Add typed endpoint adapters in their corresponding development phases.
//
//---------------------------------------------------------------------------------------------------------------------

//---------------------------------------------------------------------------------------------------------------------
// Constants.
//---------------------------------------------------------------------------------------------------------------------

const DEFAULT_TIMEOUT_MILLISECONDS = 8_000;
const INTERNAL_SERVER_ERROR         = 500;
const BAD_GATEWAY                   = 502;
const SERVICE_UNAVAILABLE           = 503;
const STEAM_API_ORIGIN              = 'https://api.steampowered.com';

//---------------------------------------------------------------------------------------------------------------------
// Types.
//---------------------------------------------------------------------------------------------------------------------

export type JsonObject = Record<string, unknown>;
export type JsonValidator<ResponseBody> = ( value: unknown ) => value is ResponseBody;
export type SteamParameterValue = boolean | number | string;

export interface SteamApiRequest<ResponseBody>
{
    interfaceName: string;
    methodName: string;
    parameters?: Readonly<Record<string, SteamParameterValue>>;
    validate: JsonValidator<ResponseBody>;
    version: number;
}

export interface SteamClientOptions
{
    apiKey: string | undefined;
    fetchFunction?: typeof fetch;
    timeoutMilliseconds?: number;
}

export type SteamClientErrorCode =
    'STEAM_CONFIGURATION_ERROR'
    | 'STEAM_INVALID_RESPONSE'
    | 'STEAM_REQUEST_FAILED'
    | 'STEAM_REQUEST_TIMEOUT'
    | 'STEAM_UNAVAILABLE';

//---------------------------------------------------------------------------------------------------------------------
// Normalized errors.
//---------------------------------------------------------------------------------------------------------------------

//---------------------------------------------------------------------------------------------------------------------
// Class: SteamClientError
//
// Description:
//
//   Represents a normalized steam client failure with safe application metadata.
//
//---------------------------------------------------------------------------------------------------------------------

export class SteamClientError extends Error
{
    public readonly code: SteamClientErrorCode;
    public readonly status: number;

    //-----------------------------------------------------------------------------------------------------------------
    // Constructor
    //
    // Description:
    //
    //   Initializes a SteamClientError instance with the supplied dependencies and state.
    //
    // Parameters:
    //
    // - code (SteamClientErrorCode):
    //   The normalized machine-readable error code.
    //
    // - message (string):
    //   The human-readable status or error message.
    //
    // - status (number):
    //   The safe HTTP status associated with the normalized error.
    //
    //-----------------------------------------------------------------------------------------------------------------

    public constructor ( code: SteamClientErrorCode, message: string, status: number )
    {
        super ( message );

        this.name   = 'SteamClientError';
        this.code   = code;
        this.status = status;
    }
}

//---------------------------------------------------------------------------------------------------------------------
// Class: SteamConfigurationError
//
// Description:
//
//   Represents a normalized steam configuration failure with safe application metadata.
//
//---------------------------------------------------------------------------------------------------------------------

export class SteamConfigurationError extends SteamClientError
{
    //-----------------------------------------------------------------------------------------------------------------
    // Constructor
    //
    // Description:
    //
    //   Initializes a SteamConfigurationError instance with the supplied dependencies and state.
    //
    //-----------------------------------------------------------------------------------------------------------------

    public constructor ()
    {
        super (
            'STEAM_CONFIGURATION_ERROR',
            'Steam API access is not configured.',
            INTERNAL_SERVER_ERROR,
        );

        this.name = 'SteamConfigurationError';
    }
}

//---------------------------------------------------------------------------------------------------------------------
// Class: SteamInvalidResponseError
//
// Description:
//
//   Represents a normalized steam invalid response failure with safe application metadata.
//
//---------------------------------------------------------------------------------------------------------------------

export class SteamInvalidResponseError extends SteamClientError
{
    //-----------------------------------------------------------------------------------------------------------------
    // Constructor
    //
    // Description:
    //
    //   Initializes a SteamInvalidResponseError instance with the supplied dependencies and state.
    //
    //-----------------------------------------------------------------------------------------------------------------

    public constructor ()
    {
        super (
            'STEAM_INVALID_RESPONSE',
            'Steam returned an invalid response.',
            BAD_GATEWAY,
        );

        this.name = 'SteamInvalidResponseError';
    }
}

//---------------------------------------------------------------------------------------------------------------------
// Class: SteamRequestFailedError
//
// Description:
//
//   Represents a normalized steam request failed failure with safe application metadata.
//
//---------------------------------------------------------------------------------------------------------------------

export class SteamRequestFailedError extends SteamClientError
{
    public readonly upstreamStatus: number;

    //-----------------------------------------------------------------------------------------------------------------
    // Constructor
    //
    // Description:
    //
    //   Initializes a SteamRequestFailedError instance with the supplied dependencies and state.
    //
    // Parameters:
    //
    // - upstreamStatus (number):
    //   The upstream status used by the operation.
    //
    //-----------------------------------------------------------------------------------------------------------------

    public constructor ( upstreamStatus: number )
    {
        super (
            'STEAM_REQUEST_FAILED',
            'Steam returned an unsuccessful response.',
            BAD_GATEWAY,
        );

        this.name           = 'SteamRequestFailedError';
        this.upstreamStatus = upstreamStatus;
    }
}

//---------------------------------------------------------------------------------------------------------------------
// Class: SteamRequestTimeoutError
//
// Description:
//
//   Represents a normalized steam request timeout failure with safe application metadata.
//
//---------------------------------------------------------------------------------------------------------------------

export class SteamRequestTimeoutError extends SteamClientError
{
    //-----------------------------------------------------------------------------------------------------------------
    // Constructor
    //
    // Description:
    //
    //   Initializes a SteamRequestTimeoutError instance with the supplied dependencies and state.
    //
    //-----------------------------------------------------------------------------------------------------------------

    public constructor ()
    {
        super (
            'STEAM_REQUEST_TIMEOUT',
            'Steam did not respond in time.',
            SERVICE_UNAVAILABLE,
        );

        this.name = 'SteamRequestTimeoutError';
    }
}

//---------------------------------------------------------------------------------------------------------------------
// Class: SteamUnavailableError
//
// Description:
//
//   Represents a normalized steam unavailable failure with safe application metadata.
//
//---------------------------------------------------------------------------------------------------------------------

export class SteamUnavailableError extends SteamClientError
{
    //-----------------------------------------------------------------------------------------------------------------
    // Constructor
    //
    // Description:
    //
    //   Initializes a SteamUnavailableError instance with the supplied dependencies and state.
    //
    //-----------------------------------------------------------------------------------------------------------------

    public constructor ()
    {
        super (
            'STEAM_UNAVAILABLE',
            'Steam is currently unavailable.',
            SERVICE_UNAVAILABLE,
        );

        this.name = 'SteamUnavailableError';
    }
}

//---------------------------------------------------------------------------------------------------------------------
// JSON helpers.
//---------------------------------------------------------------------------------------------------------------------

//---------------------------------------------------------------------------------------------------------------------
// Function: isJsonObject
//
// Description:
//
//   Determines whether the supplied value satisfies the JSON object contract.
//
// Parameters:
//
// - value (unknown):
//   The untrusted value to validate or normalize.
//
// Returns:
//
//   Whether the supplied value satisfies the JSON object contract.
//
//---------------------------------------------------------------------------------------------------------------------

export function isJsonObject ( value: unknown ): value is JsonObject
{
    return typeof value === 'object' && value !== null && !Array.isArray ( value );
}

//---------------------------------------------------------------------------------------------------------------------
// Function: parseAndValidateJson
//
// Description:
//
//   Parses and validate JSON from its serialized or user-provided representation.
//
// Parameters:
//
// - response (Response):
//   The upstream or application response to validate.
//
// - validate (JsonValidator<ResponseBody>):
//   The validate used by the operation.
//
// Returns:
//
//   The resulting Promise<ResponseBody> value.
//
//---------------------------------------------------------------------------------------------------------------------

export async function parseAndValidateJson<ResponseBody>
(
    response: Response,
    validate: JsonValidator<ResponseBody>,
): Promise<ResponseBody>
{
    let responseBody: unknown;

    try
    {
        responseBody = JSON.parse ( await response.text () ) as unknown;
    }
    catch
    {
        throw new SteamInvalidResponseError ();
    }

    if ( !validate ( responseBody ) )
    {
        throw new SteamInvalidResponseError ();
    }

    return responseBody;
}

//---------------------------------------------------------------------------------------------------------------------
// URL construction.
//---------------------------------------------------------------------------------------------------------------------

//---------------------------------------------------------------------------------------------------------------------
// Function: validateRouteSegment
//
// Description:
//
//   Validates route segment before it crosses the application boundary.
//
// Parameters:
//
// - value (string):
//   The untrusted value to validate or normalize.
//
// Returns:
//
//   Nothing.
//
//---------------------------------------------------------------------------------------------------------------------

function validateRouteSegment ( value: string ): void
{
    if ( !/^[A-Za-z][A-Za-z0-9]*$/.test ( value ) )
    {
        throw new SteamConfigurationError ();
    }
}

//---------------------------------------------------------------------------------------------------------------------
// Function: validateVersion
//
// Description:
//
//   Validates version before it crosses the application boundary.
//
// Parameters:
//
// - value (number):
//   The untrusted value to validate or normalize.
//
// Returns:
//
//   Nothing.
//
//---------------------------------------------------------------------------------------------------------------------

function validateVersion ( value: number ): void
{
    if ( !Number.isSafeInteger ( value ) || value < 1 )
    {
        throw new SteamConfigurationError ();
    }
}

//---------------------------------------------------------------------------------------------------------------------
// Function: createSteamApiUrl
//
// Description:
//
//   Creates steam API URL from the supplied inputs.
//
// Parameters:
//
// - request (SteamApiRequest<ResponseBody>):
//   The incoming application HTTP request.
//
// - apiKey (string | undefined):
//   The server-side Steam Web API key used for authenticated upstream requests.
//
// Returns:
//
//   The resulting URL value.
//
//---------------------------------------------------------------------------------------------------------------------

export function createSteamApiUrl<ResponseBody>
(
    request: SteamApiRequest<ResponseBody>,
    apiKey: string | undefined,
): URL
{
    if ( typeof apiKey !== 'string' || apiKey.trim ().length === 0 )
    {
        throw new SteamConfigurationError ();
    }

    const normalizedApiKey = apiKey.trim ();

    validateRouteSegment ( request.interfaceName );
    validateRouteSegment ( request.methodName );
    validateVersion ( request.version );

    const pathname = `${request.interfaceName}/${request.methodName}/v${request.version}/`;
    const url      = new URL ( pathname, `${STEAM_API_ORIGIN}/` );

    // The secret is attached only to the server-side upstream URL and is never included in normalized responses.

    url.searchParams.set ( 'key', normalizedApiKey );

    for ( const [ name, value ] of Object.entries ( request.parameters ?? {} ) )
    {
        url.searchParams.set ( name, String ( value ) );
    }

    return url;
}

//---------------------------------------------------------------------------------------------------------------------
// Requests.
//---------------------------------------------------------------------------------------------------------------------

//---------------------------------------------------------------------------------------------------------------------
// Function: normalizeTimeoutMilliseconds
//
// Description:
//
//   Normalizes timeout milliseconds into the application contract.
//
// Parameters:
//
// - value (number | undefined):
//   The untrusted value to validate or normalize.
//
// Returns:
//
//   The resulting number value.
//
//---------------------------------------------------------------------------------------------------------------------

function normalizeTimeoutMilliseconds ( value: number | undefined ): number
{
    const timeoutMilliseconds = value ?? DEFAULT_TIMEOUT_MILLISECONDS;

    if ( !Number.isFinite ( timeoutMilliseconds ) || timeoutMilliseconds <= 0 )
    {
        throw new SteamConfigurationError ();
    }

    return timeoutMilliseconds;
}

//---------------------------------------------------------------------------------------------------------------------
// Function: requestSteamJson
//
// Description:
//
//   Requests steam JSON through the authenticated Steam client and validates the response.
//
// Parameters:
//
// - request (SteamApiRequest<ResponseBody>):
//   The incoming application HTTP request.
//
// - options (SteamClientOptions):
//   Optional dependencies and policy overrides for the operation.
//
// Returns:
//
//   The resulting Promise<ResponseBody> value.
//
//---------------------------------------------------------------------------------------------------------------------

export async function requestSteamJson<ResponseBody>
(
    request: SteamApiRequest<ResponseBody>,
    options: SteamClientOptions,
): Promise<ResponseBody>
{
    const fetchFunction       = options.fetchFunction ?? fetch;
    const timeoutMilliseconds = normalizeTimeoutMilliseconds ( options.timeoutMilliseconds );
    const url                 = createSteamApiUrl ( request, options.apiKey );
    const abortController     = new AbortController ();
    const timeoutHandle       = setTimeout ( () => abortController.abort (), timeoutMilliseconds );
    let response: Response;

    try
    {
        // Abort the upstream request at the centralized deadline instead of allowing Worker execution to drift.

        response = await fetchFunction (
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
    }
    catch
    {
        // Distinguish an intentional deadline abort from other transport failures without exposing upstream details.

        if ( abortController.signal.aborted )
        {
            throw new SteamRequestTimeoutError ();
        }

        throw new SteamUnavailableError ();
    }
    finally
    {
        // Always release the timer, including after validation-independent fetch failures.

        clearTimeout ( timeoutHandle );
    }

    // Preserve the safe upstream status for domain mapping, but do not parse or expose a failed response body.

    if ( !response.ok )
    {
        throw new SteamRequestFailedError ( response.status );
    }

    return parseAndValidateJson ( response, request.validate );
}
