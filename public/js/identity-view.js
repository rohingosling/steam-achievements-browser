//---------------------------------------------------------------------------------------------------------------------
// File:
//   js/identity-view.js
//
// Description:
//   Presentation boundary for the User ID form and the two-card transition. Untrusted persona text is assigned with
//   textContent, while a reserved avatar frame keeps identical geometry during loading and image failure.
//---------------------------------------------------------------------------------------------------------------------

//---------------------------------------------------------------------------------------------------------------------
// Function: getResolvedUserDisplayName
//
// Description:
//
//   Retrieves resolved user display name through the appropriate application boundary.
//
// Parameters:
//
// - user (unknown):
//   The normalized Steam user associated with the operation.
//
// Returns:
//
//   The result produced by the get resolved user display name operation.
//
//---------------------------------------------------------------------------------------------------------------------

export function getResolvedUserDisplayName ( user )
{
    const personaName = typeof user.personaName === 'string' ? user.personaName.trim () : '';

    return personaName.length > 0 ? personaName : user.steamId;
}

//---------------------------------------------------------------------------------------------------------------------
// Function: bindUserIdentifierForm
//
// Description:
//
//   Binds user identifier form events to the supplied controller and state callbacks.
//
// Parameters:
//
// - form (unknown):
//   The form used by the operation.
//
// - userControl (unknown):
//   The Steam identifier input controlled by the form.
//
// - submitUserIdentifier (string):
//   The callback that commits the current Steam identifier.
//
// Returns:
//
//   Nothing.
//
//---------------------------------------------------------------------------------------------------------------------

export function bindUserIdentifierForm ( form, userControl, submitUserIdentifier )
{
    form.addEventListener ( 'submit', event =>
    {
        event.preventDefault ();

        submitUserIdentifier ( userControl );
    } );
}

//---------------------------------------------------------------------------------------------------------------------
// Function: createIdentityView
//
// Description:
//
//   Creates identity view from the supplied inputs.
//
// Parameters:
//
// - elements (unknown):
//   The DOM elements owned by the view controller.
//
// Returns:
//
//   The result produced by the create identity view operation.
//
//---------------------------------------------------------------------------------------------------------------------

export function createIdentityView ( elements )
{
    const {
        achievementCard, achievementHeading, application, avatar, avatarFrame, avatarPlaceholder,
        personaName, userCard, userControl, userStatus,
    } = elements;

    //-----------------------------------------------------------------------------------------------------------------
    // Function: showAvatarFallback
    //
    // Description:
    //
    //   Updates the interface to show avatar fallback.
    //
    // Returns:
    //
    //   Nothing.
    //
    //-----------------------------------------------------------------------------------------------------------------

    function showAvatarFallback ()
    {
        avatar.hidden                  = true;
        avatarPlaceholder.hidden       = false;
        avatarFrame.dataset.avatarState = 'fallback';
    }

    //-----------------------------------------------------------------------------------------------------------------
    // Function: showLoadedAvatar
    //
    // Description:
    //
    //   Updates the interface to show loaded avatar.
    //
    // Returns:
    //
    //   Nothing.
    //
    //-----------------------------------------------------------------------------------------------------------------

    function showLoadedAvatar ()
    {
        avatar.hidden                  = false;
        avatarPlaceholder.hidden       = true;
        avatarFrame.dataset.avatarState = 'loaded';
    }

    avatar.addEventListener ( 'load', showLoadedAvatar );
    avatar.addEventListener ( 'error', showAvatarFallback );

    //-----------------------------------------------------------------------------------------------------------------
    // Function: renderUserStatus
    //
    // Description:
    //
    //   Renders user status into its owning interface region.
    //
    // Parameters:
    //
    // - message (string):
    //   The human-readable status or error message.
    //
    // - isError (boolean):
    //   The is error used by the operation.
    //
    // Returns:
    //
    //   Nothing.
    //
    //-----------------------------------------------------------------------------------------------------------------

    function renderUserStatus ( message, isError = false )
    {
        userStatus.textContent    = message;
        userStatus.dataset.status = isError ? 'error' : 'message';
    }

    //-----------------------------------------------------------------------------------------------------------------
    // Function: setUserPending
    //
    // Description:
    //
    //   Updates user pending to reflect the current application state.
    //
    // Parameters:
    //
    // - isPending (boolean):
    //   The is pending used by the operation.
    //
    // Returns:
    //
    //   Nothing.
    //
    //-----------------------------------------------------------------------------------------------------------------

    function setUserPending ( isPending )
    {
        userCard.setAttribute ( 'aria-busy', String ( isPending ) );
        userControl.setAttribute ( 'aria-busy', String ( isPending ) );
    }

    //-----------------------------------------------------------------------------------------------------------------
    // Function: showAchievementCard
    //
    // Description:
    //
    //   Updates the interface to show achievement card.
    //
    // Parameters:
    //
    // - user (unknown):
    //   The normalized Steam user associated with the operation.
    //
    // Returns:
    //
    //   Nothing.
    //
    //-----------------------------------------------------------------------------------------------------------------

    function showAchievementCard ( user )
    {
        personaName.textContent = getResolvedUserDisplayName ( user );
        showAvatarFallback ();

        if ( typeof user.avatarUrl === 'string' && user.avatarUrl.length > 0 )
        {
            avatar.src = user.avatarUrl;
        }
        else
        {
            avatar.removeAttribute ( 'src' );
        }

        userCard.hidden        = true;
        achievementCard.hidden = false;
        application.dataset.activeCard = 'achievements';
        achievementHeading.focus ();
    }

    //-----------------------------------------------------------------------------------------------------------------
    // Function: showUserCard
    //
    // Description:
    //
    //   Updates the interface to show user card.
    //
    // Returns:
    //
    //   Nothing.
    //
    //-----------------------------------------------------------------------------------------------------------------

    function showUserCard ()
    {
        achievementCard.hidden = true;
        userCard.hidden        = false;
        application.dataset.activeCard = 'user-id';

        avatar.removeAttribute ( 'src' );
        personaName.textContent = '';
        showAvatarFallback ();
        setUserPending ( false );
        renderUserStatus ( '' );
        userControl.setAttribute ( 'aria-invalid', 'false' );
        userControl.focus ();
    }

    return (
        { renderUserStatus, setUserPending, showAchievementCard, showAvatarFallback, showUserCard }
    );
}
