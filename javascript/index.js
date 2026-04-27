document.addEventListener("DOMContentLoaded", function () {
    const observerOptions = {
        root: null, // use the viewport
        threshold: 0.15, // trigger when 15% of the element is visible
    };

    const observer = new IntersectionObserver((entries, observer) => {
        entries.forEach((entry) => {
            if (entry.isIntersecting) {
                // Add the active class to trigger the CSS animation
                entry.target.classList.add("active");
                // Stop observing after the animation has triggered (optional)
                observer.unobserve(entry.target);
            }
        });
    }, observerOptions);

    // Attach the observer to all elements with the 'reveal' class
    const revealElements = document.querySelectorAll(".reveal");
    revealElements.forEach((el) => observer.observe(el));
});