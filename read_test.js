const fs = require('fs');
try {
    const data = fs.readFileSync('test_output.txt', 'utf16le');
    const lines = data.split('\n');
    let buffer = [];
    let capturing = false;

    lines.forEach(line => {
        if (line.includes('TESTING')) {
            console.log(line.trim());
        }
        if (line.includes('FILTERS')) {
            capturing = true;
            buffer = [];
        }
        if (capturing) {
            buffer.push(line);
            if (line.trim() === '}') {
                capturing = false;
                console.log(buffer.join('\n'));
            }
        }
    });
} catch (e) {
    console.error(e.message);
}
