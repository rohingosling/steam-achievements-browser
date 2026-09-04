//---------------------------------------------------------------------------------------------------------------------
// File:
//   js/banner-view.js
//
// Description:
//   Dynamic game-banner presentation. Library Hero, Store header, Store capsule, and visible-library icon sources
//   are attempted in order. A separate best-effort Library Logo is centred only over a successful Library Hero; the
//   game name remains visible while images load or when every image source fails.
//---------------------------------------------------------------------------------------------------------------------

const APPLICATION_BANNER_TEXT     = 'Steam Achievement Browser';
const bannerScreenshotCandidates = new WeakMap ();

//---------------------------------------------------------------------------------------------------------------------
// Function: getBannerScreenshotCandidates
//
// Description:
//
//   Retrieves a defensive copy of the active banner image's ordered screenshot fallback candidates. A WeakMap keeps
//   the public Steam URLs out of serialized DOM and exported SVG markup.
//
// Parameters:
//
// - imageElement (HTMLImageElement):
//   The live banner artwork or Library Logo element.
//
// Returns:
//
//   The active source followed by its remaining ordered candidates.
//
//---------------------------------------------------------------------------------------------------------------------

export function getBannerScreenshotCandidates ( imageElement )
{
    const candidates = bannerScreenshotCandidates.get ( imageElement ) ?? [];

    return candidates.map ( candidate => ( { ...candidate } ) );
}

//---------------------------------------------------------------------------------------------------------------------
// Function: collectImageSources
//
// Description:
//
//   Collects image sources into a deterministic result.
//
// Parameters:
//
// - game (unknown):
//   The normalized game associated with the operation.
//
// Returns:
//
//   The result produced by the collect image sources operation.
//
//---------------------------------------------------------------------------------------------------------------------

function collectImageSources ( game )
{
    const bannerUrls   = Array.isArray ( game.bannerUrls ) ? game.bannerUrls : [];
    const imageSources = [ ...bannerUrls, game.iconUrl ].filter (
        imageSource => typeof imageSource === 'string' && imageSource.length > 0,
    );

    return [ ...new Set ( imageSources ) ];
}

//---------------------------------------------------------------------------------------------------------------------
// Function: findLibraryHeroSource
//
// Description:
//
//   Finds library hero source from the available candidates.
//
// Parameters:
//
// - game (unknown):
//   The normalized game associated with the operation.
//
// Returns:
//
//   The result produced by the find library hero source operation.
//
//---------------------------------------------------------------------------------------------------------------------

function findLibraryHeroSource ( game )
{
    if ( !Array.isArray ( game.bannerUrls ) )
    {
        return null;
    }

    return game.bannerUrls.find (
        imageSource => typeof imageSource === 'string'
            && /\/library_hero(?:_2x)?\.(?:jpg|png)(?:[?#]|$)/i.test ( imageSource ),
    ) ?? null;
}

//---------------------------------------------------------------------------------------------------------------------
// Function: createGameBannerController
//
// Description:
//
//   Creates game banner controller from the supplied inputs.
//
// Parameters:
//
// - artwork (unknown):
//   The artwork used by the operation.
//
// - image (unknown):
//   The image used by the operation.
//
// - gameLogo (unknown):
//   The game logo used by the operation.
//
// - fallback (unknown):
//   The fallback used by the operation.
//
// - fallbackLogo (unknown):
//   The fallback logo used by the operation.
//
// - fallbackText (unknown):
//   The fallback text used by the operation.
//
// - fallbackVersion (unknown):
//   The fallback version used by the operation.
//
// - onArtworkUnavailable (unknown):
//   The callback invoked when every artwork candidate fails.
//
// Returns:
//
//   The result produced by the create game banner controller operation.
//
//---------------------------------------------------------------------------------------------------------------------

export function createGameBannerController
(
    artwork,
    image,
    gameLogo,
    fallback,
    fallbackLogo,
    fallbackText,
    fallbackVersion,
    onArtworkUnavailable = () => undefined,
)
{
    // These source pointers reject stale image events and advance the independent artwork and logo fallback chains.

    let activeGame                 = null;
    let activeImageSource          = null;
    let activeLogoSource           = null;
    let artworkUnavailableReported = false;
    let imageSources               = [];
    let libraryHeroSource          = null;
    let libraryLogoSources         = [];
    let nextImageSource            = 0;
    let nextLogoSource             = 0;

    //-----------------------------------------------------------------------------------------------------------------
    // Function: updateArtworkScreenshotCandidates
    //
    // Description:
    //
    //   Records the live artwork source first and preserves only the untried remainder of its fallback chain.
    //
    // Returns:
    //
    //   Nothing.
    //
    //-----------------------------------------------------------------------------------------------------------------

    function updateArtworkScreenshotCandidates ()
    {
        if ( activeImageSource === null )
        {
            bannerScreenshotCandidates.delete ( image );

            return;
        }

        const remainingSources = imageSources.slice ( nextImageSource );
        const orderedSources   = [ activeImageSource, ...remainingSources ];

        bannerScreenshotCandidates.set (
            image,
            orderedSources.map ( imageSource =>
            (
                {
                    artworkKind: imageSource === libraryHeroSource ? 'library-hero' : 'fallback',
                    url:         imageSource,
                }
            ) ),
        );
    }

    //-----------------------------------------------------------------------------------------------------------------
    // Function: updateLogoScreenshotCandidates
    //
    // Description:
    //
    //   Records the live Library Logo source first and preserves only the untried remainder of its fallback chain.
    //
    // Returns:
    //
    //   Nothing.
    //
    //-----------------------------------------------------------------------------------------------------------------

    function updateLogoScreenshotCandidates ()
    {
        if ( activeLogoSource === null )
        {
            bannerScreenshotCandidates.delete ( gameLogo );

            return;
        }

        const remainingSources = libraryLogoSources.slice ( nextLogoSource );
        const orderedSources   = [ activeLogoSource, ...remainingSources ];

        bannerScreenshotCandidates.set (
            gameLogo,
            orderedSources.map ( logoSource => ( { artworkKind: null, url: logoSource } ) ),
        );
    }

    //-----------------------------------------------------------------------------------------------------------------
    // Function: hideGameLogo
    //
    // Description:
    //
    //   Updates the interface to hide game logo.
    //
    // Returns:
    //
    //   Nothing.
    //
    //-----------------------------------------------------------------------------------------------------------------

    function hideGameLogo ()
    {
        gameLogo.hidden  = true;
        activeLogoSource = null;
        bannerScreenshotCandidates.delete ( gameLogo );
        gameLogo.removeAttribute ( 'src' );
    }

    //-----------------------------------------------------------------------------------------------------------------
    // Function: loadNextLogo
    //
    // Description:
    //
    //   Retrieves next logo through the appropriate application boundary.
    //
    // Returns:
    //
    //   Nothing.
    //
    //-----------------------------------------------------------------------------------------------------------------

    function loadNextLogo ()
    {
        gameLogo.hidden = true;

        // Exhausting both best-effort logo URLs leaves the valid Library Hero visible without an overlay.

        if ( nextLogoSource >= libraryLogoSources.length )
        {
            activeLogoSource = null;
            bannerScreenshotCandidates.delete ( gameLogo );
            gameLogo.removeAttribute ( 'src' );

            return;
        }

        const logoSource = libraryLogoSources [ nextLogoSource ];

        activeLogoSource = logoSource;
        nextLogoSource   += 1;
        updateLogoScreenshotCandidates ();
        gameLogo.setAttribute ( 'src', logoSource );
    }

    //-----------------------------------------------------------------------------------------------------------------
    // Function: showFallbackText
    //
    // Description:
    //
    //   Updates the interface to show fallback text.
    //
    // Returns:
    //
    //   Nothing.
    //
    //-----------------------------------------------------------------------------------------------------------------

    function showFallbackText ()
    {
        artwork.hidden  = true;
        image.hidden    = true;
        fallback.hidden = false;
    }

    //-----------------------------------------------------------------------------------------------------------------
    // Function: loadNextImage
    //
    // Description:
    //
    //   Retrieves next image through the appropriate application boundary.
    //
    // Returns:
    //
    //   Nothing.
    //
    //-----------------------------------------------------------------------------------------------------------------

    function loadNextImage ()
    {
        hideGameLogo ();
        showFallbackText ();

        // Report total artwork failure once per selected game after every ordered source has failed.

        if ( nextImageSource >= imageSources.length )
        {
            activeImageSource = null;
            bannerScreenshotCandidates.delete ( image );
            image.removeAttribute ( 'src' );

            if ( activeGame !== null && !artworkUnavailableReported )
            {
                artworkUnavailableReported = true;
                onArtworkUnavailable ( activeGame );
            }

            return;
        }

        const imageSource = imageSources [ nextImageSource ];

        activeImageSource = imageSource;
        nextImageSource   += 1;
        updateArtworkScreenshotCandidates ();
        image.setAttribute ( 'src', imageSource );
    }

    image.addEventListener ( 'load', () =>
    {
        // Ignore a delayed load event from a source that is no longer active.

        if ( activeImageSource === null || image.getAttribute ( 'src' ) !== activeImageSource )
        {
            return;
        }

        image.hidden        = false;
        artwork.hidden      = false;
        fallback.hidden     = true;
        artwork.setAttribute (
            'data-artwork-kind',
            activeImageSource === libraryHeroSource ? 'library-hero' : 'fallback',
        );

        // Only a Library Hero may receive the separate transparent Library Logo overlay.

        if ( activeImageSource === libraryHeroSource )
        {
            loadNextLogo ();
        }
    } );

    image.addEventListener ( 'error', () =>
    {
        if ( image.getAttribute ( 'src' ) !== activeImageSource )
        {
            return;
        }

        loadNextImage ();
    } );

    gameLogo.addEventListener ( 'load', () =>
    {
        if (
            activeLogoSource === null
            || gameLogo.getAttribute ( 'src' ) !== activeLogoSource
            || activeImageSource !== libraryHeroSource
            || image.hidden
        )
        {
            return;
        }

        gameLogo.hidden = false;
    } );

    gameLogo.addEventListener ( 'error', () =>
    {
        if ( activeLogoSource === null || gameLogo.getAttribute ( 'src' ) !== activeLogoSource )
        {
            return;
        }

        loadNextLogo ();
    } );

    //-----------------------------------------------------------------------------------------------------------------
    // Function: render
    //
    // Description:
    //
    //   Resets the banner and begins the ordered artwork fallback chain for the selected game.
    //
    // Parameters:
    //
    // - game (unknown):
    //   The normalized game associated with the operation.
    //
    // Returns:
    //
    //   Nothing.
    //
    //-----------------------------------------------------------------------------------------------------------------

    function render ( game = null )
    {
        // Reset every source-specific flag before presenting the neutral pre-selection motif or a new game.

        image.removeAttribute ( 'src' );
        artwork.removeAttribute ( 'data-artwork-kind' );
        hideGameLogo ();
        bannerScreenshotCandidates.delete ( image );
        image.alt                  = '';
        activeGame                 = game;
        activeImageSource          = null;
        activeLogoSource           = null;
        artworkUnavailableReported = false;
        imageSources               = [];
        libraryHeroSource          = null;
        libraryLogoSources         = [];
        nextImageSource            = 0;
        nextLogoSource             = 0;
        fallbackText.textContent   = APPLICATION_BANNER_TEXT;
        fallbackLogo.hidden        = false;
        fallbackVersion.hidden     = false;

        showFallbackText ();

        if ( game === null )
        {
            return;
        }

        fallbackText.textContent = game.name;
        fallbackLogo.hidden      = true;
        fallbackVersion.hidden   = true;
        image.alt                = `${game.name} artwork`;
        imageSources             = collectImageSources ( game );
        libraryHeroSource        = findLibraryHeroSource ( game );
        libraryLogoSources       = Array.isArray ( game.libraryLogoUrls )
            ? [ ...new Set ( game.libraryLogoUrls.filter (
                logoSource => typeof logoSource === 'string' && logoSource.length > 0,
            ) ) ]
            : [];

        loadNextImage ();
    }

    return (
        { render }
    );
}
