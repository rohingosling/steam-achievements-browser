//---------------------------------------------------------------------------------------------------------------------
// File:
//   js/progress-view.js
//
// Description:
//   Semantic achievement-progress rendering for initial, loading, no-achievement, partial, and complete states.
//
//   The normalized API remains authoritative for unlocked and total counts. This view only chooses human-readable
//   wording and reflects those counts into a native progress element; it never derives progress from visible rows.
//---------------------------------------------------------------------------------------------------------------------

const DEFAULT_STATUS = 'Select a game to view achievement progress.';
const NO_GAME_PROGRESS_SUMMARY = 'Achievements unlocked';
const NO_GAME_PROGRESS_VALUE_TEXT = '0% achievements unlocked';

//---------------------------------------------------------------------------------------------------------------------
// Function: formatProgressSummary
//
// Description:
//
//   Formats progress summary for user-facing display.
//
// Parameters:
//
// - progress (unknown):
//   The normalized achievement progress to render.
//
// Returns:
//
//   The result produced by the format progress summary operation.
//
//---------------------------------------------------------------------------------------------------------------------

function formatProgressSummary ( progress )
{
    if ( progress.total === 0 )
    {
        return 'This game has no Steam achievements.';
    }

    if ( progress.unlocked === progress.total )
    {
        return `All ${progress.total} achievements unlocked.`;
    }

    return `${progress.unlocked} of ${progress.total} achievements unlocked`;
}

//---------------------------------------------------------------------------------------------------------------------
// Function: createAchievementProgressController
//
// Description:
//
//   Creates achievement progress controller from the supplied inputs.
//
// Parameters:
//
// - region (unknown):
//   The region used by the operation.
//
// - summary (unknown):
//   The summary used by the operation.
//
// - percentage (unknown):
//   The percentage used by the operation.
//
// - progressBar (unknown):
//   The progress bar used by the operation.
//
// - rosette (unknown):
//   The rosette used by the operation.
//
// Returns:
//
//   The result produced by the create achievement progress controller operation.
//
//---------------------------------------------------------------------------------------------------------------------

export function createAchievementProgressController ( region, summary, percentage, progressBar, rosette )
{
    //-----------------------------------------------------------------------------------------------------------------
    // Function: setCompletionState
    //
    // Description:
    //
    //   Updates completion state to reflect the current application state.
    //
    // Parameters:
    //
    // - isComplete (boolean):
    //   The is complete used by the operation.
    //
    // Returns:
    //
    //   Nothing.
    //
    //-----------------------------------------------------------------------------------------------------------------

    function setCompletionState ( isComplete )
    {
        region.setAttribute ( 'data-progress-complete', String ( isComplete ) );

        if ( isComplete )
        {
            rosette.removeAttribute ( 'hidden' );
        }
        else
        {
            rosette.setAttribute ( 'hidden', '' );
        }
    }

    //-----------------------------------------------------------------------------------------------------------------
    // Function: hideProgressBar
    //
    // Description:
    //
    //   Updates the interface to hide progress bar.
    //
    // Returns:
    //
    //   Nothing.
    //
    //-----------------------------------------------------------------------------------------------------------------

    function hideProgressBar ()
    {
        percentage.hidden = true;
        progressBar.hidden = true;
        progressBar.removeAttribute ( 'aria-valuetext' );
        progressBar.removeAttribute ( 'value' );

        setCompletionState ( false );
    }

    //-----------------------------------------------------------------------------------------------------------------
    // Function: renderStatus
    //
    // Description:
    //
    //   Renders status into its owning interface region.
    //
    // Parameters:
    //
    // - message (string):
    //   The human-readable status or error message.
    //
    // Returns:
    //
    //   Nothing.
    //
    //-----------------------------------------------------------------------------------------------------------------

    function renderStatus ( message = DEFAULT_STATUS )
    {
        region.setAttribute ( 'aria-busy', 'false' );
        summary.textContent = message;

        hideProgressBar ();
    }

    //-----------------------------------------------------------------------------------------------------------------
    // Function: renderLoading
    //
    // Description:
    //
    //   Renders loading into its owning interface region.
    //
    // Parameters:
    //
    // - message (string):
    //   The human-readable status or error message.
    //
    // Returns:
    //
    //   Nothing.
    //
    //-----------------------------------------------------------------------------------------------------------------

    function renderLoading ( message )
    {
        region.setAttribute ( 'aria-busy', 'true' );
        summary.textContent = message;
        percentage.hidden   = true;
        progressBar.hidden  = false;

        progressBar.removeAttribute ( 'aria-valuetext' );
        progressBar.removeAttribute ( 'value' );

        setCompletionState ( false );
    }

    //-----------------------------------------------------------------------------------------------------------------
    // Function: renderNoGameSelected
    //
    // Description:
    //
    //   Renders no game selected into its owning interface region.
    //
    // Returns:
    //
    //   Nothing.
    //
    //-----------------------------------------------------------------------------------------------------------------

    function renderNoGameSelected ()
    {
        region.setAttribute ( 'aria-busy', 'false' );
        summary.textContent     = NO_GAME_PROGRESS_SUMMARY;
        percentage.hidden      = false;
        percentage.textContent = '0 %';
        progressBar.hidden     = false;
        progressBar.max        = 100;
        progressBar.value      = 0;
        progressBar.setAttribute ( 'aria-valuetext', NO_GAME_PROGRESS_VALUE_TEXT );

        setCompletionState ( false );
    }

    //-----------------------------------------------------------------------------------------------------------------
    // Function: render
    //
    // Description:
    //
    //   Renders normalized achievement totals, percentage, progress-bar value, and completion state.
    //
    // Parameters:
    //
    // - progress (unknown):
    //   The normalized achievement progress to render.
    //
    // Returns:
    //
    //   Nothing.
    //
    //-----------------------------------------------------------------------------------------------------------------

    function render ( progress )
    {
        const progressSummary = formatProgressSummary ( progress );

        region.setAttribute ( 'aria-busy', 'false' );
        summary.textContent = progressSummary;

        if ( progress.total === 0 )
        {
            hideProgressBar ();

            return;
        }

        const isComplete = progress.unlocked === progress.total;

        percentage.hidden      = false;
        percentage.textContent = `${Math.round ( progress.percentage )} %`;
        progressBar.hidden     = false;
        progressBar.max        = progress.total;
        progressBar.value      = progress.unlocked;
        progressBar.setAttribute ( 'aria-valuetext', progressSummary );

        setCompletionState ( isComplete );
    }

    return (
        {
            render,
            renderLoading,
            renderNoGameSelected,
            renderStatus,
        }
    );
}
