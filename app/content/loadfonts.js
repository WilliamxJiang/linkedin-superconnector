// loadfont.js

async function injectAeonikFonts() {
    const fontFiles = [
        {
            weight: 400,
            style: 'normal',
            file: 'AeonikTRIAL-Regular.otf'
        },
        {
            weight: 700,
            style: 'normal',
            file: 'AeonikTRIAL-Bold.otf'
        },
        {
            weight: 700,
            style: 'italic',
            file: 'AeonikTRIAL-BoldItalic.otf'
        },
        {
            weight: 300,
            style: 'normal',
            file: 'AeonikTRIAL-Light.otf'
        },
        {
            weight: 300,
            style: 'italic',
            file: 'AeonikTRIAL-LightItalic.otf'
        },
        {
            weight: 400,
            style: 'italic',
            file: 'AeonikTRIAL-RegularItalic.otf'
        }
    ];

    const fontFaceRules = await Promise.all(
        fontFiles.map(async ({weight, style, file}) => {
            const url = await chrome.runtime.getURL(`assets/fonts/${file}`);
            return `
@font-face {
    font-family: 'Aeonik';
    src: url('${url}') format('opentype');
    font-weight: ${weight};
    font-style: ${style};
}
            `.trim();
        })
    );

    const style = document.createElement('style');
    style.textContent = fontFaceRules.join('\n');
    document.head.appendChild(style);
}

injectAeonikFonts();