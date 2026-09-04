//---------------------------------------------------------------------------------------------------------------------
// File:
//   js/list-view.js
//
// Description:
//   Builds semantic achievement rows from the application's normalized selected-game response. Rows are created once
//   per game load, then moved as existing nodes whenever the current sort order changes.
//---------------------------------------------------------------------------------------------------------------------

const ACHIEVEMENT_LIST_ELEMENT_ID = 'achievement-list';
const ACHIEVEMENT_ICON_SIZE        = 64;
const ACHIEVEMENT_PERCENT_DIGITS   = 1;
const ITEM_PROGRESS_DECIMAL_DIGITS = 2;
const UNLOCKED_DATE_LOCALE         = 'en-GB';

const UNLOCKED_DATE_FORMATTER = new Intl.DateTimeFormat
(
    UNLOCKED_DATE_LOCALE,
    {
        dateStyle : 'long',
        timeStyle : 'short',
    }
);

const ITEM_PROGRESS_NUMBER_FORMATTER = new Intl.NumberFormat
(
    UNLOCKED_DATE_LOCALE,
    {
        maximumFractionDigits: ITEM_PROGRESS_DECIMAL_DIGITS,
    }
);

let achievementRowsByApiName = new Map ();

//---------------------------------------------------------------------------------------------------------------------
// Row value formatting.
//---------------------------------------------------------------------------------------------------------------------

//---------------------------------------------------------------------------------------------------------------------
// Function: formatAchievementRarity
//
// Description:
//
//   Formats achievement rarity for user-facing display.
//
// Parameters:
//
// - globalPercentage (unknown):
//   The global percentage used by the operation.
//
// Returns:
//
//   The result produced by the format achievement rarity operation.
//
//---------------------------------------------------------------------------------------------------------------------

export function formatAchievementRarity ( globalPercentage )
{
    if ( globalPercentage === null || !Number.isFinite ( globalPercentage ) )
    {
        return 'Rarity unavailable';
    }

    return `${globalPercentage.toFixed ( ACHIEVEMENT_PERCENT_DIGITS )}% global rarity`;
}

//---------------------------------------------------------------------------------------------------------------------
// Function: formatAchievementUnlockTime
//
// Description:
//
//   Formats achievement unlock time for user-facing display.
//
// Parameters:
//
// - unlockTime (number):
//   The Unix timestamp associated with the unlock state.
//
// - achieved (boolean):
//   The achieved used by the operation.
//
// Returns:
//
//   The result produced by the format achievement unlock time operation.
//
//---------------------------------------------------------------------------------------------------------------------

export function formatAchievementUnlockTime ( unlockTime, achieved = unlockTime !== null )
{
    if ( !achieved )
    {
        return 'Locked';
    }

    if ( unlockTime === null || !Number.isFinite ( unlockTime ) )
    {
        return 'Unlocked';
    }

    return `Unlocked ${UNLOCKED_DATE_FORMATTER.format ( new Date ( unlockTime * 1000 ) )}`;
}

//---------------------------------------------------------------------------------------------------------------------
// Function: formatAchievementItemProgress
//
// Description:
//
//   Formats achievement item progress for user-facing display.
//
// Parameters:
//
// - itemProgress (unknown):
//   The optional item-specific achievement progress to display.
//
// Returns:
//
//   The result produced by the format achievement item progress operation.
//
//---------------------------------------------------------------------------------------------------------------------

export function formatAchievementItemProgress ( itemProgress )
{
    const current = ITEM_PROGRESS_NUMBER_FORMATTER.format ( itemProgress.current );
    const target  = ITEM_PROGRESS_NUMBER_FORMATTER.format ( itemProgress.target );

    return `${current} / ${target}`;
}

//---------------------------------------------------------------------------------------------------------------------
// Element construction helpers.
//---------------------------------------------------------------------------------------------------------------------

//---------------------------------------------------------------------------------------------------------------------
// Function: createAchievementIcon
//
// Description:
//
//   Creates achievement icon from the supplied inputs.
//
// Parameters:
//
// - achievement (unknown):
//   The achievement used by the operation.
//
// Returns:
//
//   The result produced by the create achievement icon operation.
//
//---------------------------------------------------------------------------------------------------------------------

function createAchievementIcon ( achievement )
{
    const iconFrame   = document.createElement ( 'span' );
    const icon        = document.createElement ( 'img' );
    const placeholder = document.createElement ( 'span' );
    const iconUrl     = achievement.achieved
        ? achievement.iconUrl ?? achievement.iconGrayUrl
        : achievement.iconGrayUrl ?? achievement.iconUrl;

    iconFrame.className   = 'achievement-row__icon-frame';
    placeholder.className = 'achievement-row__icon-placeholder';
    placeholder.hidden    = iconUrl !== null;
    placeholder.setAttribute ( 'aria-hidden', 'true' );

    icon.className = 'achievement-row__icon';
    icon.width     = ACHIEVEMENT_ICON_SIZE;
    icon.height    = ACHIEVEMENT_ICON_SIZE;
    icon.loading   = 'lazy';
    icon.decoding  = 'async';
    icon.alt       = '';
    icon.hidden    = iconUrl === null;

    if ( iconUrl !== null )
    {
        icon.src = iconUrl;
    }

    icon.addEventListener ( 'error', () =>
    {
        icon.hidden        = true;
        placeholder.hidden = false;
        icon.removeAttribute ( 'src' );
    } );

    iconFrame.append ( icon, placeholder );

    return iconFrame;
}

//---------------------------------------------------------------------------------------------------------------------
// Function: createAchievementCopy
//
// Description:
//
//   Creates achievement copy from the supplied inputs.
//
// Parameters:
//
// - achievement (unknown):
//   The achievement used by the operation.
//
// Returns:
//
//   The result produced by the create achievement copy operation.
//
//---------------------------------------------------------------------------------------------------------------------

function createAchievementCopy ( achievement )
{
    const copy        = document.createElement ( 'span' );
    const name        = document.createElement ( 'span' );
    const description = document.createElement ( 'span' );

    copy.className          = 'achievement-row__copy';
    name.className          = 'achievement-row__name';
    name.textContent        = achievement.name;
    description.className   = 'achievement-row__description';
    description.textContent = achievement.description ?? '';
    description.hidden      = achievement.description === null || achievement.description.length === 0;

    copy.append ( name, description );

    const itemProgress = createAchievementItemProgress ( achievement.progress );

    if ( itemProgress !== null )
    {
        copy.append ( itemProgress );
    }

    return copy;
}

//---------------------------------------------------------------------------------------------------------------------
// Function: createAchievementItemProgress
//
// Description:
//
//   Creates achievement item progress from the supplied inputs.
//
// Parameters:
//
// - itemProgress (unknown):
//   The optional item-specific achievement progress to display.
//
// Returns:
//
//   The result produced by the create achievement item progress operation.
//
//---------------------------------------------------------------------------------------------------------------------

function createAchievementItemProgress ( itemProgress )
{
    if (
        itemProgress === null
        || itemProgress === undefined
        || !Number.isFinite ( itemProgress.current )
        || !Number.isFinite ( itemProgress.minimum )
        || !Number.isFinite ( itemProgress.target )
        || itemProgress.current < itemProgress.minimum
        || itemProgress.target <= 1
        || itemProgress.target <= itemProgress.minimum
    )
    {
        return null;
    }

    const currentValue = Math.min ( itemProgress.current, itemProgress.target );
    const progress      = document.createElement ( 'span' );
    const progressBar   = document.createElement ( 'progress' );
    const progressText  = document.createElement ( 'span' );
    const visibleText   = formatAchievementItemProgress (
        {
            current: currentValue,
            minimum: itemProgress.minimum,
            target:  itemProgress.target,
        },
    );

    progress.className       = 'achievement-row__item-progress';
    progressBar.className    = 'achievement-row__item-progress-bar';
    progressBar.max          = itemProgress.target - itemProgress.minimum;
    progressBar.value        = currentValue - itemProgress.minimum;
    progressBar.textContent  = visibleText;
    progressText.className   = 'achievement-row__item-progress-text';
    progressText.textContent = visibleText;
    progressBar.setAttribute ( 'aria-label', `Achievement progress: ${visibleText.replace ( ' / ', ' of ' )}` );

    progress.append ( progressBar, progressText );

    return progress;
}

//---------------------------------------------------------------------------------------------------------------------
// Function: createRarityText
//
// Description:
//
//   Creates rarity text from the supplied inputs.
//
// Parameters:
//
// - globalPercentage (unknown):
//   The global percentage used by the operation.
//
// Returns:
//
//   The result produced by the create rarity text operation.
//
//---------------------------------------------------------------------------------------------------------------------

function createRarityText ( globalPercentage )
{
    const rarityText = document.createElement ( 'span' );

    rarityText.className   = 'achievement-row__rarity-text';
    rarityText.textContent = formatAchievementRarity ( globalPercentage );

    return rarityText;
}

//---------------------------------------------------------------------------------------------------------------------
// Function: createAchievementMetadata
//
// Description:
//
//   Creates achievement metadata from the supplied inputs.
//
// Parameters:
//
// - achievement (unknown):
//   The achievement used by the operation.
//
// Returns:
//
//   The result produced by the create achievement metadata operation.
//
//---------------------------------------------------------------------------------------------------------------------

function createAchievementMetadata ( achievement )
{
    const hasUnlockTime = achievement.achieved && achievement.unlockTime !== null;
    const metadata      = document.createElement ( 'span' );
    const unlockText    = document.createElement ( hasUnlockTime ? 'time' : 'span' );

    metadata.className     = 'achievement-row__metadata';
    unlockText.className   = 'achievement-row__unlock-state';
    unlockText.textContent = formatAchievementUnlockTime ( achievement.unlockTime, achievement.achieved );

    if ( hasUnlockTime )
    {
        unlockText.dateTime = new Date ( achievement.unlockTime * 1000 ).toISOString ();
    }

    metadata.append ( createRarityText ( achievement.globalPercentage ), unlockText );

    return metadata;
}

//---------------------------------------------------------------------------------------------------------------------
// Function: buildAchievementRow
//
// Description:
//
//   Creates achievement row from the supplied inputs.
//
// Parameters:
//
// - achievement (unknown):
//   The achievement used by the operation.
//
// Returns:
//
//   The result produced by the build achievement row operation.
//
//---------------------------------------------------------------------------------------------------------------------

function buildAchievementRow ( achievement )
{
    const row = document.createElement ( 'li' );

    row.className                = 'achievement-row';
    row.dataset.achievementName  = achievement.apiName;
    row.dataset.achievementState = achievement.achieved ? 'unlocked' : 'locked';
    row.append (
        createAchievementIcon ( achievement ),
        createAchievementCopy ( achievement ),
        createAchievementMetadata ( achievement ),
    );

    return row;
}

//---------------------------------------------------------------------------------------------------------------------
// Public row lifecycle.
//---------------------------------------------------------------------------------------------------------------------

//---------------------------------------------------------------------------------------------------------------------
// Function: clearAchievementRows
//
// Description:
//
//   Resets achievement rows to its initial state.
//
// Returns:
//
//   Nothing.
//
//---------------------------------------------------------------------------------------------------------------------

export function clearAchievementRows ()
{
    achievementRowsByApiName = new Map ();
}

//---------------------------------------------------------------------------------------------------------------------
// Function: buildAchievementRows
//
// Description:
//
//   Creates achievement rows from the supplied inputs.
//
// Parameters:
//
// - achievements (array):
//   The normalized achievements to process.
//
// Returns:
//
//   The result produced by the build achievement rows operation.
//
//---------------------------------------------------------------------------------------------------------------------

export function buildAchievementRows ( achievements )
{
    achievementRowsByApiName = new Map
    (
        achievements.map ( achievement => [ achievement.apiName, buildAchievementRow ( achievement ) ] )
    );

    return achievementRowsByApiName;
}

//---------------------------------------------------------------------------------------------------------------------
// Function: applyAchievementOrder
//
// Description:
//
//   Applies achievement order to the current application state or view.
//
// Parameters:
//
// - orderedAchievements (array):
//   The ordered achievements used by the operation.
//
// Returns:
//
//   Nothing.
//
//---------------------------------------------------------------------------------------------------------------------

export function applyAchievementOrder ( orderedAchievements )
{
    const list = document.getElementById ( ACHIEVEMENT_LIST_ELEMENT_ID );

    if ( list === null || achievementRowsByApiName.size === 0 )
    {
        return;
    }

    const fragment = document.createDocumentFragment ();

    orderedAchievements.forEach ( achievement =>
    {
        const row = achievementRowsByApiName.get ( achievement.apiName );

        if ( row !== undefined )
        {
            fragment.appendChild ( row );
        }
    } );

    list.replaceChildren ( fragment );
    list.scrollTop = 0;
}
