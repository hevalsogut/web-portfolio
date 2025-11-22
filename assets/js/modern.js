// Custom Slow Smooth Scroll
document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', function (e) {
        e.preventDefault();
        const targetId = this.getAttribute('href');
        const targetSection = document.querySelector(targetId);
        
        if (targetSection) {
            smoothScrollTo(targetSection, 1500); // 1.5 seconds duration
        }
    });
});

function smoothScrollTo(element, duration) {
    const targetPosition = element.getBoundingClientRect().top;
    const startPosition = window.pageYOffset;
    const distance = targetPosition; // Distance relative to viewport is exactly what we need if we add it to startPosition, but getBoundingClientRect is relative to viewport. 
    // Actually window.scrollTo takes absolute document coordinates.
    // targetPosition (relative to viewport) + startPosition (current scroll) = Absolute Target
    const absoluteTarget = startPosition + targetPosition;
    const distanceToScroll = absoluteTarget - startPosition;

    let startTime = null;

    function animation(currentTime) {
        if (startTime === null) startTime = currentTime;
        const timeElapsed = currentTime - startTime;
        const run = ease(timeElapsed, startPosition, distanceToScroll, duration);
        window.scrollTo(0, run);

        if (timeElapsed < duration) requestAnimationFrame(animation);
    }

    // Easing function (easeInOutCubic for smoother feel)
    function ease(t, b, c, d) {
        t /= d / 2;
        if (t < 1) return c / 2 * t * t * t + b;
        t -= 2;
        return c / 2 * (t * t * t + 2) + b;
    }

    requestAnimationFrame(animation);
}

// Fluid Background Interaction (Optional - subtle movement)
document.addEventListener('mousemove', (e) => {
    const blobs = document.querySelectorAll('.blob');
    const x = e.clientX / window.innerWidth;
    const y = e.clientY / window.innerHeight;

    blobs.forEach((blob, index) => {
        const speed = (index + 1) * 20;
        const xOffset = (window.innerWidth / 2 - e.clientX) / speed;
        const yOffset = (window.innerHeight / 2 - e.clientY) / speed;
        
        blob.style.transform = `translate(${xOffset}px, ${yOffset}px)`;
    });
});

// Scroll Reveal
const observerOptions = {
    threshold: 0.1
};

const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
        if (entry.isIntersecting) {
            entry.target.style.opacity = '1';
            entry.target.style.transform = 'translateY(0)';
        }
    });
}, observerOptions);

document.querySelectorAll('.timeline-item, .project-card').forEach(el => {
    el.style.opacity = '0';
    el.style.transform = 'translateY(20px)';
    el.style.transition = 'all 0.6s ease-out';
    observer.observe(el);
});

// Typewriter Effect
const roles = ["AI Software Developer", "Automation Developer", "Computer Engineering Student"];
const badge = document.getElementById('role-badge');
let roleIndex = 0;
let charIndex = 0;
let isDeleting = false;
let typeSpeed = 100;

function typeWriter() {
    if (!badge) return;

    const currentRole = roles[roleIndex];
    
    if (isDeleting) {
        badge.textContent = currentRole.substring(0, charIndex - 1);
        charIndex--;
        typeSpeed = 50;
    } else {
        badge.textContent = currentRole.substring(0, charIndex + 1);
        charIndex++;
        typeSpeed = 100;
    }

    if (!isDeleting && charIndex === currentRole.length) {
        isDeleting = true;
        typeSpeed = 2000; // Pause at end
    } else if (isDeleting && charIndex === 0) {
        isDeleting = false;
        roleIndex = (roleIndex + 1) % roles.length;
        typeSpeed = 500; // Pause before typing new
    }

    setTimeout(typeWriter, typeSpeed);
}

// Start typing
typeWriter();


// Mouse Tracking for Background Glow & Parallax
const mouseGlow = document.getElementById('mouse-glow');
const blobs = document.querySelectorAll('.blob');

window.addEventListener('mousemove', (e) => {
    const posX = e.clientX;
    const posY = e.clientY;

    // Background Glow (Follower)
    if (mouseGlow) {
        mouseGlow.animate({
            left: `${posX}px`,
            top: `${posY}px`
        }, { duration: 2000, fill: "forwards" });
    }

    // Parallax Effect for Blobs
    blobs.forEach((blob, index) => {
        const speed = (index + 1) * 0.05; // Different speeds for depth
        const x = (window.innerWidth - posX * speed) / 100;
        const y = (window.innerHeight - posY * speed) / 100;

        // Use transform to move blobs slightly opposite to mouse
        const shiftX = (posX - window.innerWidth / 2) * speed;
        const shiftY = (posY - window.innerHeight / 2) * speed;

        blob.animate({
            transform: `translate(${shiftX}px, ${shiftY}px)`
        }, { duration: 3000, fill: "forwards" });
    });
});

// 3D Tilt Effect for Cards
document.querySelectorAll('.nav-card, .project-card').forEach(card => {
    card.addEventListener('mousemove', (e) => {
        const rect = card.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        
        const centerX = rect.width / 2;
        const centerY = rect.height / 2;
        
        const rotateX = ((y - centerY) / centerY) * -5; // Max 5deg rotation
        const rotateY = ((x - centerX) / centerX) * 5;

        card.style.transform = `perspective(1000px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) scale3d(1.02, 1.02, 1.02)`;
    });

    card.addEventListener('mouseleave', () => {
        card.style.transform = 'perspective(1000px) rotateX(0) rotateY(0) scale3d(1, 1, 1)';
    });
});
