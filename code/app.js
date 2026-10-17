const menuButton = document.querySelector('.menu-button');
const sideMenu = document.querySelector('.side-menu');
const menuBackdrop = document.querySelector('.menu-backdrop');
const closeControls = document.querySelectorAll('[data-menu-close]');
const firstMenuLink = sideMenu?.querySelector('a');

function setMenu(open) {
    if (!menuButton || !sideMenu || !menuBackdrop) return;

    document.body.classList.toggle('menu-open', open);
    sideMenu.classList.toggle('is-open', open);
    menuBackdrop.classList.toggle('is-open', open);
    menuButton.setAttribute('aria-expanded', String(open));
    sideMenu.setAttribute('aria-hidden', String(!open));
    menuBackdrop.setAttribute('aria-hidden', String(!open));

    if (open) {
        firstMenuLink?.focus();
    } else {
        menuButton.focus();
    }
}

menuButton?.addEventListener('click', () => setMenu(true));
closeControls.forEach((control) => control.addEventListener('click', () => setMenu(false)));

document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && sideMenu?.classList.contains('is-open')) {
        setMenu(false);
    }
});

const year = document.querySelector('#current-year');
if (year) year.textContent = String(new Date().getFullYear());
