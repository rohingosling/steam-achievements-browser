//---------------------------------------------------------------------------------------------------------------------
// File:
//   js/sort-fields.js
//
// Description:
//   Defines the three achievement sort fields and projects the complete canonical achievement array into the rows
//   currently displayed. Visibility filtering and field comparison are pure and never mutate source state.
//---------------------------------------------------------------------------------------------------------------------

const SORT_COLLATOR = new Intl.Collator
(
    'en',
    {
        numeric     : false,
        sensitivity : 'variant',
        usage       : 'sort',
    }
);

export const SORT_FIELDS =
[
    {
        announcement : 'Sorted by rarity, rarest first.',
        id           : 'rarity',
        label        : 'Rarity',
    },
    {
        announcement : 'Sorted by name, A to Z.',
        id           : 'name',
        label        : 'Name',
    },
    {
        announcement : 'Sorted by date unlocked, most recent first.',
        id           : 'date-unlocked',
        label        : 'Date Unlocked',
    },
];

export const DEFAULT_SORT_FIELD_ID = 'rarity';

//---------------------------------------------------------------------------------------------------------------------
// Registry lookup.
//---------------------------------------------------------------------------------------------------------------------

//---------------------------------------------------------------------------------------------------------------------
// Function: resolveSortField
//
// Description:
//
//   Resolves sort field into the normalized value required by its caller.
//
// Parameters:
//
// - fieldId (string):
//   The requested achievement sort-field identifier.
//
// Returns:
//
//   The result produced by the resolve sort field operation.
//
//---------------------------------------------------------------------------------------------------------------------

export function resolveSortField ( fieldId )
{
    return SORT_FIELDS.find ( field => field.id === fieldId )
        ?? SORT_FIELDS.find ( field => field.id === DEFAULT_SORT_FIELD_ID );
}

//---------------------------------------------------------------------------------------------------------------------
// Deterministic comparisons.
//---------------------------------------------------------------------------------------------------------------------

//---------------------------------------------------------------------------------------------------------------------
// Function: compareAchievementNames
//
// Description:
//
//   Compares two values using the deterministic achievement names ordering.
//
// Parameters:
//
// - leftAchievement (unknown):
//   The left achievement used by the operation.
//
// - rightAchievement (unknown):
//   The right achievement used by the operation.
//
// Returns:
//
//   The result produced by the compare achievement names operation.
//
//---------------------------------------------------------------------------------------------------------------------

function compareAchievementNames ( leftAchievement, rightAchievement )
{
    const nameDifference = SORT_COLLATOR.compare ( leftAchievement.name, rightAchievement.name );

    if ( nameDifference !== 0 )
    {
        return nameDifference;
    }

    return leftAchievement.apiName < rightAchievement.apiName
        ? -1
        : leftAchievement.apiName > rightAchievement.apiName
            ? 1
            : 0;
}

//---------------------------------------------------------------------------------------------------------------------
// Function: compareNullableNumbers
//
// Description:
//
//   Compares two values using the deterministic nullable numbers ordering.
//
// Parameters:
//
// - leftValue (unknown):
//   The left value used by the operation.
//
// - rightValue (unknown):
//   The right value used by the operation.
//
// - direction (unknown):
//   The direction used by the operation.
//
// Returns:
//
//   The result produced by the compare nullable numbers operation.
//
//---------------------------------------------------------------------------------------------------------------------

function compareNullableNumbers ( leftValue, rightValue, direction )
{
    if ( leftValue === null && rightValue !== null )
    {
        return 1;
    }

    if ( leftValue !== null && rightValue === null )
    {
        return -1;
    }

    if ( leftValue === null && rightValue === null )
    {
        return 0;
    }

    return ( leftValue - rightValue ) * direction;
}

//---------------------------------------------------------------------------------------------------------------------
// Function: compareAchievements
//
// Description:
//
//   Compares two values using the deterministic achievements ordering.
//
// Parameters:
//
// - leftAchievement (unknown):
//   The left achievement used by the operation.
//
// - rightAchievement (unknown):
//   The right achievement used by the operation.
//
// - fieldId (string):
//   The requested achievement sort-field identifier.
//
// Returns:
//
//   The result produced by the compare achievements operation.
//
//---------------------------------------------------------------------------------------------------------------------

function compareAchievements ( leftAchievement, rightAchievement, fieldId )
{
    if ( fieldId === 'name' )
    {
        return compareAchievementNames ( leftAchievement, rightAchievement );
    }

    if ( fieldId === 'date-unlocked' )
    {
        const unlockTimeDifference = compareNullableNumbers (
            leftAchievement.unlockTime,
            rightAchievement.unlockTime,
            -1,
        );

        return unlockTimeDifference !== 0
            ? unlockTimeDifference
            : compareAchievementNames ( leftAchievement, rightAchievement );
    }

    const rarityDifference = compareNullableNumbers (
        leftAchievement.globalPercentage,
        rightAchievement.globalPercentage,
        1,
    );

    return rarityDifference !== 0
        ? rarityDifference
        : compareAchievementNames ( leftAchievement, rightAchievement );
}

//---------------------------------------------------------------------------------------------------------------------
// Display projection.
//---------------------------------------------------------------------------------------------------------------------

//---------------------------------------------------------------------------------------------------------------------
// Function: sortAchievements
//
// Description:
//
//   Sorts achievements without mutating the source collection.
//
// Parameters:
//
// - achievements (array):
//   The normalized achievements to process.
//
// - fieldId (string):
//   The requested achievement sort-field identifier.
//
// Returns:
//
//   The result produced by the sort achievements operation.
//
//---------------------------------------------------------------------------------------------------------------------

export function sortAchievements ( achievements, fieldId )
{
    const resolvedField = resolveSortField ( fieldId );

    return achievements.slice ().sort (
        ( leftAchievement, rightAchievement ) => compareAchievements (
            leftAchievement,
            rightAchievement,
            resolvedField.id,
        ),
    );
}

//---------------------------------------------------------------------------------------------------------------------
// Function: selectAchievementsForDisplay
//
// Description:
//
//   Selects achievements for display from the available normalized data.
//
// Parameters:
//
// - achievements (array):
//   The normalized achievements to process.
//
// - fieldId (string):
//   The requested achievement sort-field identifier.
//
// - showLockedAchievements (boolean):
//   Whether locked achievements should remain visible.
//
// Returns:
//
//   The result produced by the select achievements for display operation.
//
//---------------------------------------------------------------------------------------------------------------------

export function selectAchievementsForDisplay ( achievements, fieldId, showLockedAchievements )
{
    const visibleAchievements = showLockedAchievements
        ? achievements.slice ()
        : achievements.filter ( achievement => achievement.achieved );

    return sortAchievements ( visibleAchievements, fieldId );
}
