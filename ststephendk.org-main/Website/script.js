// JavaScript for St. Stephen Catholic Church Website

function renderSharedLayout() {
    const pathName = window.location.pathname.replace(/\\/g, '/');
    const isSocietyPage = pathName.includes('/societies/');
    const basePrefix = isSocietyPage ? '../' : '';
    const currentPage = pathName.split('/').pop() || 'index.html';
    const aboutPages = ['about.html', 'history.html', 'clergy.html', 'parish-leadership.html', 'upcoming-events.html'];
    const activePage = isSocietyPage ? 'ministries.html' : (aboutPages.includes(currentPage) ? 'about.html' : currentPage);
    const navItems = [
        { href: 'index.html', label: 'Home' },
        { href: 'about.html', label: 'About Us' },
        { href: 'mass-schedule.html', label: 'Mass Schedule' },
        { href: 'ministries.html', label: 'Parish Groups' },
        { href: 'bulletin.html', label: 'Bulletin' },
        { href: 'gallery.html', label: 'Gallery' },
        { href: 'contact.html', label: 'Contact' }
    ];

    const headerHost = document.getElementById('site-header');
    if (headerHost) {
        const navMarkup = navItems.map(function(item) {
            const activeClass = item.href === activePage ? ' class="active"' : '';
            return '<li><a href="' + basePrefix + item.href + '"' + activeClass + '>' + item.label + '</a></li>';
        }).join('');

        headerHost.innerHTML =
            '<header>' +
                '<div class="logo-container">' +
                    '<div class="logo">' +
                        '<img src="' + basePrefix + 'images/Logos/Church\'s Logo.png" alt="St. Stephen Catholic Church logo" class="church-logo-icon">' +
                        '<h1>St. Stephen Catholic Church</h1>' +
                    '</div>' +
                '</div>' +
                '<nav>' +
                    '<ul>' + navMarkup + '</ul>' +
                '</nav>' +
                '<div class="menu-toggle">' +
                    '<i class="fas fa-bars"></i>' +
                '</div>' +
            '</header>';
    }

    const footerHost = document.getElementById('site-footer');
    if (footerHost) {
        footerHost.innerHTML =
            '<footer>' +
                '<div class="container">' +
                    '<div class="footer-content">' +
                        '<div class="footer-logo">' +
                            '<img src="' + basePrefix + 'images/Logos/Church\'s Logo.png" alt="St. Stephen Catholic Church logo" class="church-logo-icon">' +
                            '<h2>St. Stephen Catholic Church</h2>' +
                            '<p>Darkuman, Accra, Ghana</p>' +
                        '</div>' +
                        '<div class="footer-links">' +
                            '<h3>Quick Links</h3>' +
                            '<ul>' +
                                '<li><a href="' + basePrefix + 'index.html">Home</a></li>' +
                                '<li><a href="' + basePrefix + 'about.html">About Us</a></li>' +
                                '<li><a href="' + basePrefix + 'mass-schedule.html">Mass Schedule</a></li>' +
                                '<li><a href="' + basePrefix + 'ministries.html">Parish Groups</a></li>' +
                                '<li><a href="' + basePrefix + 'bulletin.html">Bulletin</a></li>' +
                                '<li><a href="' + basePrefix + 'gallery.html">Gallery</a></li>' +
                                '<li><a href="' + basePrefix + 'contact.html">Contact</a></li>' +
                            '</ul>' +
                        '</div>' +
                        '<div class="footer-contact">' +
                            '<h3>Contact Us</h3>' +
                            '<p><i class="fas fa-map-marker-alt"></i> P. O. Box DK 389, Darkuman - Accra, Ghana</p>' +
                            '<p><i class="fas fa-phone"></i> +233 506078423 / +233 242017920</p>' +
                            '<p><i class="fas fa-envelope"></i> ststephendk@gmail.com</p>' +
                        '</div>' +
                        '<div class="footer-social">' +
                            '<h3>Connect With Us</h3>' +
                            '<div class="social-icons">' +
                                '<a href="https://www.facebook.com/search/top?q=St.%20Stephen%20Parish%20-%20Darkuman" target="_blank" rel="noopener" aria-label="Facebook"><i class="fab fa-facebook"></i></a>' +
                                '<a href="https://www.instagram.com/ststephenyouth_darkuman/" target="_blank" rel="noopener" aria-label="Instagram"><i class="fab fa-instagram"></i></a>' +
                                '<a href="https://www.tiktok.com/@st.stephen.parish" target="_blank" rel="noopener" aria-label="TikTok"><i class="fab fa-tiktok"></i></a>' +
                                '<a href="https://t.me/youth600" target="_blank" rel="noopener" aria-label="Telegram"><i class="fab fa-telegram"></i></a>' +
                            '</div>' +
                        '</div>' +
                    '</div>' +
                    '<div class="footer-bottom">' +
                        '<p>&copy; 2025 St. Stephen Catholic Church. All Rights Reserved.</p>' +
                    '</div>' +
                '</div>' +
            '</footer>';
    }
}

function initGalleryScroll() {
    const imageGallery = document.querySelector('.image-gallery');
    const prevBtn = document.querySelector('.gallery-nav.prev');
    const nextBtn = document.querySelector('.gallery-nav.next');

    if (!imageGallery || !prevBtn || !nextBtn) {
        return;
    }

    const scrollAmount = 320;

    prevBtn.addEventListener('click', function() {
        imageGallery.scrollBy({
            left: -scrollAmount,
            behavior: 'smooth'
        });
    });

    nextBtn.addEventListener('click', function() {
        imageGallery.scrollBy({
            left: scrollAmount,
            behavior: 'smooth'
        });
    });
}

function initMobileMenu() {
    const menuToggle = document.querySelector('.menu-toggle');
    const menuIcon = document.querySelector('.menu-icon');
    const mobileMenuButton = menuToggle || menuIcon;
    const nav = document.querySelector('nav');

    if (!mobileMenuButton || !nav) {
        return;
    }

    function setToggleState(isOpen) {
        if (menuIcon) {
            menuIcon.classList.toggle('active', isOpen);
            return;
        }

        if (menuToggle) {
            const icon = menuToggle.querySelector('i');
            if (!icon) {
                return;
            }

            icon.classList.toggle('fa-bars', !isOpen);
            icon.classList.toggle('fa-times', isOpen);
        }
    }

    mobileMenuButton.addEventListener('click', function() {
        const isOpen = !nav.classList.contains('active');
        nav.classList.toggle('active', isOpen);
        setToggleState(isOpen);
    });

    document.addEventListener('click', function(event) {
        const clickedMenuButton = mobileMenuButton.contains(event.target);
        if (nav.classList.contains('active') && !nav.contains(event.target) && !clickedMenuButton) {
            nav.classList.remove('active');
            setToggleState(false);
        }
    });

    nav.querySelectorAll('a').forEach(function(link) {
        link.addEventListener('click', function() {
            if (nav.classList.contains('active')) {
                nav.classList.remove('active');
                setToggleState(false);
            }
        });
    });
}

function initSmoothScrolling() {
    document.querySelectorAll('a[href^="#"]').forEach(function(anchor) {
        anchor.addEventListener('click', function(e) {
            const targetId = this.getAttribute('href');
            if (targetId === '#') {
                return;
            }

            const targetElement = document.querySelector(targetId);
            if (!targetElement) {
                return;
            }

            e.preventDefault();
            targetElement.scrollIntoView({
                behavior: 'smooth'
            });
        });
    });
}

document.addEventListener('DOMContentLoaded', function() {
    renderSharedLayout();
    initGalleryScroll();
    initMobileMenu();
    initSmoothScrolling();
});
